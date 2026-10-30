/**
 * Referrals / affiliates (Phase 4, feature 12). Flag `referrals` — OFF.
 *
 * Flow: each customer gets a personal code/link (?ref=CODE). A visitor
 * arriving with a code gets a 30-day attribution cookie — FIRST-touch:
 * an existing cookie is never overwritten by a later code. Checkout
 * sends the code; the server validates it, rejects self-referrals, and
 * records the attribution (status "pending", orderId unique → a double
 * checkout can never double-record). The payment webhook flips the
 * attribution to "earned". Commission % comes from owner config.
 *
 * Payouts are RECORDED-ONLY: the owner panel lists commissions so the
 * owner can pay affiliates manually. There is deliberately no payout
 * integration, and nothing here moves money.
 *
 * Persistence: ReferralCode/ReferralAttribution tables when a DB is
 * configured, else .data/referrals.json.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { encryptPii, hashSubject, piiConfigured } from "./pii.ts";
import { round2 } from "./byo.ts";

export const REF_COOKIE_NAME = "astralium-ref";
export const REF_TTL_DAYS = 30;

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// ─── Configuration ───────────────────────────────────────────────────────────

export interface ReferralConfig {
  commissionPercent: number;
}

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = { commissionPercent: 10 };

export function sanitizeReferralConfig(raw: unknown): ReferralConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_REFERRAL_CONFIG;
  const pct = Number((raw as { commissionPercent?: unknown }).commissionPercent);
  return { commissionPercent: Number.isFinite(pct) ? Math.min(50, Math.max(0, pct)) : DEFAULT_REFERRAL_CONFIG.commissionPercent };
}

export async function getReferralConfig(): Promise<ReferralConfig> {
  return getJsonConfig<ReferralConfig>("referral_config", "referral-config.json", sanitizeReferralConfig, DEFAULT_REFERRAL_CONFIG);
}

export async function setReferralConfig(config: ReferralConfig): Promise<{ persisted: "db" | "file"; value: ReferralConfig }> {
  return setJsonConfig("referral_config", "referral-config.json", config, sanitizeReferralConfig);
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

export function generateCode(): string {
  const bytes = randomBytes(8);
  let body = "";
  for (let i = 0; i < 8; i++) body += ALPHABET[bytes[i] % ALPHABET.length];
  return `ASTR-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/** Read the referral code from a Cookie header (pure). */
export function parseRefCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.split("=");
    if (k.trim() === REF_COOKIE_NAME) {
      const value = normalizeCode(decodeURIComponent(rest.join("=").trim()));
      return value || null;
    }
  }
  return null;
}

/**
 * First-touch attribution: a stored cookie wins; an incoming code is
 * attributed only when there is no cookie yet (pure).
 */
export function firstTouchCode(existingCookie: string | null, incoming: string | null): string | null {
  if (existingCookie) return existingCookie;
  return incoming ? normalizeCode(incoming) || null : null;
}

/** Commission for an order total at a percent (pure, 2dp). */
export function commissionFor(orderTotalUSD: number, commissionPercent: number): number {
  return round2(Math.max(0, orderTotalUSD) * (Math.min(50, Math.max(0, commissionPercent)) / 100));
}

export function referralLink(base: string, code: string, locale = "en"): string {
  return `${base.replace(/\/$/, "")}/${locale}?ref=${encodeURIComponent(code)}`;
}

// ─── Store (DB → .data fallback) ─────────────────────────────────────────────

export interface ReferralCodeRecord {
  id: string;
  code: string;
  emailHash: string;
  emailCipher: string;
  createdAt: string;
}

export interface AttributionRecord {
  id: string;
  orderId: string;
  referralCodeId: string;
  code: string;
  buyerEmailHash: string;
  commissionPercent: number;
  orderTotalUSD: number;
  commissionUSD: number;
  status: "pending" | "earned";
  createdAt: string;
}

interface ReferralStore {
  codes: ReferralCodeRecord[];
  attributions: AttributionRecord[];
}

const STORE_PATH = path.join(process.cwd(), ".data", "referrals.json");

async function readStore(): Promise<ReferralStore> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as ReferralStore;
    return { codes: raw.codes ?? [], attributions: raw.attributions ?? [] };
  } catch {
    return { codes: [], attributions: [] };
  }
}

async function writeStore(store: ReferralStore): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function emailHashOf(email: string): string {
  return hashSubject(email.trim().toLowerCase());
}

export async function getOrCreateReferralCode(email: string): Promise<ReferralCodeRecord> {
  const emailHash = emailHashOf(email);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const existing = await db.referralCode.findUnique({ where: { emailHash } });
      if (existing) {
        return { id: existing.id, code: existing.code, emailHash, emailCipher: existing.emailCipher, createdAt: existing.createdAt.toISOString() };
      }
      const created = await db.referralCode.create({
        data: { code: generateCode(), emailHash, emailCipher: piiConfigured() ? encryptPii(email.trim().toLowerCase()) : "" },
      });
      return { id: created.id, code: created.code, emailHash, emailCipher: created.emailCipher, createdAt: created.createdAt.toISOString() };
    } catch {
      // fall through
    }
  }
  const store = await readStore();
  const existing = store.codes.find((c) => c.emailHash === emailHash);
  if (existing) return existing;
  const record: ReferralCodeRecord = {
    id: randomUUID(), code: generateCode(), emailHash,
    emailCipher: piiConfigured() ? encryptPii(email.trim().toLowerCase()) : "",
    createdAt: new Date().toISOString(),
  };
  store.codes.push(record);
  await writeStore(store);
  return record;
}

export async function findCode(code: string): Promise<ReferralCodeRecord | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.referralCode.findUnique({ where: { code: normalized } });
      if (row) return { id: row.id, code: row.code, emailHash: row.emailHash, emailCipher: row.emailCipher, createdAt: row.createdAt.toISOString() };
    } catch {
      // fall through
    }
  }
  const store = await readStore();
  return store.codes.find((c) => c.code === normalized) ?? null;
}

export type AttributionResult =
  | { ok: true; attribution: AttributionRecord; duplicate: boolean }
  | { ok: false; error: "UNKNOWN_CODE" | "SELF_REFERRAL" };

/**
 * Record an order's attribution — idempotent by orderId (a second call
 * returns the original record with duplicate: true), and self-referrals
 * (buyer == code owner) are rejected outright.
 */
export async function recordAttribution(input: {
  code: string;
  orderId: string;
  buyerEmail: string;
  orderTotalUSD: number;
  commissionPercent: number;
}): Promise<AttributionResult> {
  const owner = await findCode(input.code);
  if (!owner) return { ok: false, error: "UNKNOWN_CODE" };
  const buyerEmailHash = emailHashOf(input.buyerEmail);
  if (buyerEmailHash === owner.emailHash) return { ok: false, error: "SELF_REFERRAL" };
  const commissionUSD = commissionFor(input.orderTotalUSD, input.commissionPercent);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const existing = await db.referralAttribution.findUnique({ where: { orderId: input.orderId } });
      if (existing) {
        return {
          ok: true, duplicate: true,
          attribution: {
            id: existing.id, orderId: existing.orderId, referralCodeId: existing.referralCodeId,
            code: owner.code, buyerEmailHash: existing.buyerEmailHash,
            commissionPercent: existing.commissionPercent, orderTotalUSD: existing.orderTotalUSD,
            commissionUSD: existing.commissionUSD, status: existing.status as "pending" | "earned",
            createdAt: existing.createdAt.toISOString(),
          },
        };
      }
      const created = await db.referralAttribution.create({
        data: {
          orderId: input.orderId, referralCodeId: owner.id, buyerEmailHash,
          commissionPercent: input.commissionPercent, orderTotalUSD: input.orderTotalUSD, commissionUSD,
        },
      });
      return {
        ok: true, duplicate: false,
        attribution: {
          id: created.id, orderId: created.orderId, referralCodeId: created.referralCodeId,
          code: owner.code, buyerEmailHash, commissionPercent: created.commissionPercent,
          orderTotalUSD: created.orderTotalUSD, commissionUSD: created.commissionUSD,
          status: "pending", createdAt: created.createdAt.toISOString(),
        },
      };
    } catch {
      // fall through
    }
  }
  const store = await readStore();
  const existing = store.attributions.find((a) => a.orderId === input.orderId);
  if (existing) return { ok: true, attribution: existing, duplicate: true };
  const record: AttributionRecord = {
    id: randomUUID(), orderId: input.orderId, referralCodeId: owner.id, code: owner.code,
    buyerEmailHash, commissionPercent: input.commissionPercent,
    orderTotalUSD: input.orderTotalUSD, commissionUSD, status: "pending",
    createdAt: new Date().toISOString(),
  };
  store.attributions.push(record);
  await writeStore(store);
  return { ok: true, attribution: record, duplicate: false };
}

/** Flip an order's attribution to earned (payment webhook). Idempotent. */
export async function markAttributionEarned(orderId: string): Promise<boolean> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const res = await db.referralAttribution.updateMany({
        where: { orderId, status: "pending" },
        data: { status: "earned" },
      });
      if (res.count > 0) return true;
    } catch {
      // fall through
    }
  }
  const store = await readStore();
  const record = store.attributions.find((a) => a.orderId === orderId);
  if (!record || record.status === "earned") return false;
  record.status = "earned";
  await writeStore(store);
  return true;
}

/** Owner panel: every recorded commission (payouts are manual). */
export async function listCommissions(): Promise<AttributionRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.referralAttribution.findMany({
        include: { referralCode: true },
        orderBy: { createdAt: "desc" },
      });
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id, orderId: r.orderId, referralCodeId: r.referralCodeId,
          code: r.referralCode.code, buyerEmailHash: r.buyerEmailHash,
          commissionPercent: r.commissionPercent, orderTotalUSD: r.orderTotalUSD,
          commissionUSD: r.commissionUSD, status: r.status as "pending" | "earned",
          createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch {
      // fall through
    }
  }
  const store = await readStore();
  return [...store.attributions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Stats for one customer's referral panel. */
export async function referralStats(email: string): Promise<{ code: string; clicks: number; orders: number; earnedUSD: number; pendingUSD: number } | null> {
  const mine = await getOrCreateReferralCode(email).catch(() => null);
  if (!mine) return null;
  const all = await listCommissions();
  const own = all.filter((a) => a.referralCodeId === mine.id);
  return {
    code: mine.code,
    clicks: 0, // click counting is intentionally not tracked (privacy-first)
    orders: own.length,
    earnedUSD: round2(own.filter((a) => a.status === "earned").reduce((s, a) => s + a.commissionUSD, 0)),
    pendingUSD: round2(own.filter((a) => a.status === "pending").reduce((s, a) => s + a.commissionUSD, 0)),
  };
}

/** Cleanup helper (tests). */
export async function deleteReferralCodeForEmail(email: string): Promise<void> {
  const emailHash = emailHashOf(email);
  const store = await readStore();
  const mine = store.codes.filter((c) => c.emailHash === emailHash).map((c) => c.id);
  store.codes = store.codes.filter((c) => c.emailHash !== emailHash);
  store.attributions = store.attributions.filter((a) => !mine.includes(a.referralCodeId));
  await writeStore(store);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.referralCode.delete({ where: { emailHash } });
    } catch {
      // nothing to clean
    }
  }
}
