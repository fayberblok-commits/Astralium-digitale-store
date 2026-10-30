/**
 * One-time order claim codes + signed referral tokens (Phase 2).
 *
 * Claim code: a short human-typable code ("AST-XXXX-XXXX") the customer
 * sends to the store's WhatsApp / Messenger / Instagram to receive their
 * download links. Only the SHA-256 hash is stored (ClaimCode table when a
 * DB is configured, in-memory map otherwise). Codes are order-bound,
 * expiring (default 7 days) and single-use: redeeming marks the record
 * used BEFORE links are issued, so a replayed code can never re-unlock.
 *
 * Referral ("ref") tokens: stateless signed payloads for m.me / ig.me
 * deep links — { oid, pids, ch, exp } + HMAC-SHA256, domain-separated from
 * download tokens by the "ref:" signing prefix.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.ts";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — unambiguous when typed
export const CLAIM_CODE_TTL_SECONDS = 7 * 24 * 3600;
export const REF_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

function secret(): string {
  return process.env.DOWNLOAD_SIGNING_SECRET || "dev-only-insecure-signing-secret-change-me-0123456789";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** "ast ab3k-9zqx" → "ASTAB3K9ZQX" (canonical form used for hashing). */
export function normalizeClaimCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatClaimCode(canonical: string): string {
  const body = canonical.replace(/^AST/, "");
  return `AST-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

/** Extract a claim code from free message text; returns canonical form or null. */
export function extractClaimCode(text: string): string | null {
  const m = text.toUpperCase().match(/AST[-\s]?([A-Z0-9]{4})[-\s]?([A-Z0-9]{4})/);
  if (!m) return null;
  return `AST${m[1]}${m[2]}`;
}

interface ClaimRecord {
  codeHash: string;
  orderId: string;
  productIds: string[];
  channel: string | null;
  expiresAt: number; // unix seconds
  usedAt: number | null;
}

const memoryClaims = new Map<string, ClaimRecord>();

export function __resetMemoryClaims(): void {
  memoryClaims.clear();
}

export async function issueClaimCode(params: {
  orderId: string;
  productIds: string[];
  channel?: string | null;
  ttlSeconds?: number;
}): Promise<{ code: string; expiresAt: Date }> {
  let body = "";
  const bytes = randomBytes(8);
  for (let i = 0; i < 8; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  const canonical = `AST${body}`;
  const codeHash = sha256Hex(canonical);
  const expiresAt = new Date(Date.now() + (params.ttlSeconds ?? CLAIM_CODE_TTL_SECONDS) * 1000);
  const record: ClaimRecord = {
    codeHash,
    orderId: params.orderId,
    productIds: [...params.productIds],
    channel: params.channel ?? null,
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
    usedAt: null,
  };
  memoryClaims.set(codeHash, record);
  try {
    const db = await getDb();
    if (db) {
      await db.claimCode.create({
        data: {
          codeHash,
          orderId: params.orderId,
          productIds: params.productIds,
          channel: params.channel ?? null,
          expiresAt,
        },
      });
    }
  } catch {
    // Order rows may not exist in DB (orders persist via webhooks) — the
    // in-memory record remains authoritative for this process, exactly like
    // the Phase-1 bindings fallback. Never fail issuance over the DB.
  }
  return { code: formatClaimCode(canonical), expiresAt };
}

export type RedeemResult =
  | { ok: true; orderId: string; productIds: string[] }
  | { ok: false; reason: "not-found" | "expired" | "used" };

export async function redeemClaimCode(rawCode: string, nowSeconds?: number): Promise<RedeemResult> {
  const canonical = normalizeClaimCode(rawCode);
  if (!/^AST[A-Z0-9]{8}$/.test(canonical)) return { ok: false, reason: "not-found" };
  const codeHash = sha256Hex(canonical);
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);

  // DB first (source of truth when configured).
  try {
    const db = await getDb();
    if (db) {
      const row = await db.claimCode.findUnique({ where: { codeHash } });
      if (row) {
        if (row.usedAt) return { ok: false, reason: "used" };
        if (row.expiresAt.getTime() / 1000 < now) return { ok: false, reason: "expired" };
        await db.claimCode.update({ where: { codeHash }, data: { usedAt: new Date() } });
        memoryClaims.delete(codeHash);
        return { ok: true, orderId: row.orderId, productIds: row.productIds };
      }
    }
  } catch {
    // fall through to memory
  }

  const record = memoryClaims.get(codeHash);
  if (!record) return { ok: false, reason: "not-found" };
  if (record.usedAt) return { ok: false, reason: "used" };
  if (record.expiresAt < now) return { ok: false, reason: "expired" };
  record.usedAt = now; // mark used BEFORE links are issued — replay-safe
  return { ok: true, orderId: record.orderId, productIds: [...record.productIds] };
}

// ─── Signed referral tokens (m.me / ig.me ?ref=) ─────────────────────────────

export interface RefTokenPayload {
  oid: string;
  pids: string[];
  ch: "messenger" | "instagram" | "whatsapp";
  exp: number;
}

function signRef(body: string): string {
  return createHmac("sha256", secret()).update(`ref:${body}`).digest("base64url");
}

export function createRefToken(payload: Omit<RefTokenPayload, "exp">, ttlSeconds = REF_TOKEN_TTL_SECONDS): string {
  const full: RefTokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${signRef(body)}`;
}

export type RefVerifyResult =
  | { ok: true; payload: RefTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyRefToken(token: string, nowSeconds?: number): RefVerifyResult {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;
  const expected = signRef(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  let payload: RefTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as RefTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload.oid || !Array.isArray(payload.pids) || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
