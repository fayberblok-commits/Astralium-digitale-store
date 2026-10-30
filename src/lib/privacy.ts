/**
 * Privacy center (Phase 6, feature 30). Flag `privacy_center` — ON.
 *
 * Flows (public page /[locale]/privacy-center):
 *  1. Export: buyer enters an email → we email a signed one-time link
 *     (32-byte random token, stored ONLY as a SHA-256 hash, 1h TTL,
 *     single-use) → the link downloads a JSON assembled from the real
 *     stores: orders, license keys (last-4 only — full keys are never
 *     stored anywhere), loyalty balance + ledger, consent records,
 *     subscriptions, wishlist alerts. Without a database there is no
 *     order ledger (fulfilment is webhook/log-based — same honest
 *     caveat as earlier phases) and the export says so explicitly.
 *  2. Deletion: same verified link, but execution needs an explicit
 *     POST confirmation (email scanners following GET links must never
 *     delete anything). Execution ANONYMISES: order rows keep their
 *     amounts/status/items (financial records are preserved) while the
 *     email becomes a hash tombstone; loyalty accounts are deleted;
 *     license/subscription rows are re-keyed to the tombstone hash;
 *     consent records, wishlist alerts and cart snapshots are deleted.
 *     The job writes an audit-log entry.
 *  3. Consent preferences: analytics/marketing categories land in the
 *     ConsentRecord store (channels "analytics" / "marketing"); a
 *     marketing opt-out also records the "email" channel opt-out that
 *     feature 20's automation checks before every send.
 *  4. Retention: `privacy_config.retentionDays` (admin) is applied by
 *     the cron-secret cleanup job to analytics events, expired privacy
 *     requests and read owner alerts.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import {
  decryptPii, deleteMemoryConsentFor, encryptPii, hashSubject, memoryConsentEntries, piiConfigured, recordConsent,
} from "./pii.ts";
import { getLoyaltyBalance, listLoyaltyEntries, deleteLoyaltyAccount } from "./loyalty.ts";
import { listLicenseKeys } from "./license.ts";
import { findSubscriptionByEmail } from "./subscriptions.ts";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface PrivacyConfig { retentionDays: number }
export const DEFAULT_PRIVACY_CONFIG: PrivacyConfig = { retentionDays: 365 };

export function sanitizePrivacyConfig(raw: unknown): PrivacyConfig {
  const r = (raw ?? {}) as Partial<PrivacyConfig>;
  const days = Math.floor(Number(r.retentionDays));
  return { retentionDays: Number.isFinite(days) ? Math.min(3650, Math.max(7, days)) : 365 };
}

export async function getPrivacyConfig(): Promise<PrivacyConfig> {
  return getJsonConfig("privacy_config", "privacy-config.json", sanitizePrivacyConfig, DEFAULT_PRIVACY_CONFIG);
}

export async function setPrivacyConfig(value: PrivacyConfig): Promise<{ persisted: "db" | "file"; value: PrivacyConfig }> {
  return setJsonConfig("privacy_config", "privacy-config.json", value, sanitizePrivacyConfig);
}

// ─── Tombstones ──────────────────────────────────────────────────────────────

export function tombstoneEmail(emailHash: string): string {
  return `deleted+${emailHash.slice(0, 16)}@anonymized.invalid`;
}

export function tombstoneHash(emailHash: string): string {
  return createHash("sha256").update(`deleted:${emailHash}`).digest("hex");
}

// ─── Requests (one-time verified links) ──────────────────────────────────────

export type PrivacyRequestKind = "export" | "delete";
export type PrivacyRequestStatus = "pending" | "done" | "expired";

export interface PrivacyRequestRecord {
  id: string;
  kind: PrivacyRequestKind;
  emailHash: string;
  emailCipher: string;
  tokenHash: string;
  status: PrivacyRequestStatus;
  createdAt: string;
  expiresAt: string;
  executedAt: string | null;
}

const REQUESTS_PATH = path.join(process.cwd(), ".data", "privacy-requests.json");
export const PRIVACY_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function readFileRequests(): Promise<PrivacyRequestRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(REQUESTS_PATH, "utf8")) as PrivacyRequestRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeFileRequests(list: PrivacyRequestRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(REQUESTS_PATH), { recursive: true });
  await fs.writeFile(REQUESTS_PATH, JSON.stringify(list, null, 2), "utf8");
}

async function saveRequest(rec: PrivacyRequestRecord): Promise<void> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.privacyRequest.upsert({
        where: { id: rec.id },
        create: {
          id: rec.id, kind: rec.kind, emailHash: rec.emailHash, emailCipher: rec.emailCipher,
          tokenHash: rec.tokenHash, status: rec.status, expiresAt: new Date(rec.expiresAt),
          executedAt: rec.executedAt ? new Date(rec.executedAt) : null,
        },
        update: { status: rec.status, executedAt: rec.executedAt ? new Date(rec.executedAt) : null, emailCipher: rec.emailCipher },
      });
      return;
    } catch { /* fall through to file */ }
  }
  const all = await readFileRequests();
  const idx = all.findIndex((r) => r.id === rec.id);
  if (idx >= 0) all[idx] = rec; else all.push(rec);
  await writeFileRequests(all);
}

async function findRequestByToken(token: string): Promise<PrivacyRequestRecord | null> {
  const tokenHash = hashToken(token);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.privacyRequest.findUnique({ where: { tokenHash } });
      if (row) {
        return {
          id: row.id, kind: row.kind as PrivacyRequestKind, emailHash: row.emailHash,
          emailCipher: row.emailCipher, tokenHash: row.tokenHash, status: row.status as PrivacyRequestStatus,
          createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
          executedAt: row.executedAt?.toISOString() ?? null,
        };
      }
    } catch { /* fall through */ }
  }
  return (await readFileRequests()).find((r) => r.tokenHash === tokenHash) ?? null;
}

/** Create a request; returns the plaintext token ONCE (for the email link). */
export async function createPrivacyRequest(
  email: string,
  kind: PrivacyRequestKind,
  now = new Date(),
): Promise<{ token: string; expiresAt: string }> {
  const clean = email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const rec: PrivacyRequestRecord = {
    id: randomUUID(),
    kind,
    emailHash: hashSubject(clean),
    emailCipher: piiConfigured() ? encryptPii(clean) : "",
    tokenHash: hashToken(token),
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PRIVACY_TOKEN_TTL_MS).toISOString(),
    executedAt: null,
  };
  await saveRequest(rec);
  return { token, expiresAt: rec.expiresAt };
}

/**
 * Resolve a token WITHOUT consuming it (the page render). Expired
 * pending requests are flipped to `expired` as a side effect.
 */
export async function resolvePrivacyRequest(token: string, now = new Date()): Promise<PrivacyRequestRecord | null> {
  if (!token || token.length < 20) return null;
  const rec = await findRequestByToken(token);
  if (!rec) return null;
  if (rec.status === "pending" && new Date(rec.expiresAt) <= now) {
    rec.status = "expired";
    await saveRequest(rec);
    return null;
  }
  return rec.status === "pending" ? rec : null;
}

/** Consume a token (single-use): only a pending request can transition. */
export async function consumePrivacyRequest(token: string, now = new Date()): Promise<PrivacyRequestRecord | null> {
  const rec = await resolvePrivacyRequest(token, now);
  if (!rec) return null;
  rec.status = "done";
  rec.executedAt = now.toISOString();
  rec.emailCipher = ""; // the link has served its purpose — scrub the address
  await saveRequest(rec);
  return rec;
}

export function requestEmail(rec: PrivacyRequestRecord): string | null {
  return rec.emailCipher ? decryptPii(rec.emailCipher) : null;
}

// ─── Export assembly ─────────────────────────────────────────────────────────

export interface PrivacyExport {
  generatedAt: string;
  email: string;
  orders: { available: boolean; note?: string; items: unknown[] };
  licenses: unknown[];
  loyalty: unknown;
  consents: unknown[];
  subscriptions: unknown[];
  wishlistAlerts: unknown[];
}

/**
 * Assemble everything the real stores hold for `email`. Pure data out —
 * no download tokens, no full license keys (they exist only as hashes),
 * no provider secrets.
 */
export async function assembleExport(email: string): Promise<PrivacyExport> {
  const clean = email.trim().toLowerCase();
  const emailHash = hashSubject(clean);
  const out: PrivacyExport = {
    generatedAt: new Date().toISOString(),
    email: clean,
    orders: { available: false, items: [] },
    licenses: [],
    loyalty: null,
    consents: [],
    subscriptions: [],
    wishlistAlerts: [],
  };

  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.order.findMany({
        where: { email: clean },
        include: { items: true },
        orderBy: { createdAt: "desc" },
      });
      out.orders = {
        available: true,
        items: rows.map((o) => ({
          id: o.id, status: o.status, totalUSD: o.totalUSD, currency: o.currency,
          provider: o.provider, createdAt: o.createdAt.toISOString(),
          items: o.items.map((i) => ({ productId: i.productId, priceUSD: i.priceUSD })),
        })),
      };
      const consents = await db.consentRecord.findMany({
        where: { subjectHash: emailHash },
        orderBy: { createdAt: "asc" },
      });
      out.consents = consents.map((c) => ({ channel: c.channel, granted: c.granted, createdAt: c.createdAt.toISOString() }));
      const alerts = await db.wishlistAlert.findMany({ where: { emailHash } });
      out.wishlistAlerts = alerts.map((a) => ({ productId: a.productId, priceAtSave: a.priceAtSave, createdAt: a.createdAt.toISOString() }));
    } catch { /* sections stay honestly empty/flagged */ }
  } else {
    out.orders = {
      available: false,
      note: "No database is configured on this deployment, so no order ledger exists to export (fulfilment records live with the payment provider).",
      items: [],
    };
  }
  if (out.consents.length === 0) {
    out.consents = memoryConsentEntries()
      .filter((c) => c.subjectHash === emailHash)
      .map((c) => ({ channel: c.channel, granted: c.granted, createdAt: c.createdAt.toISOString() }));
  }

  const keys = await listLicenseKeys(1000);
  out.licenses = keys
    .filter((k) => k.emailHash === emailHash)
    .map((k) => ({
      productId: k.productId, orderId: k.orderId, keyLast4: k.last4, status: k.status,
      activations: k.activations.length, activationLimit: k.activationLimit, createdAt: k.createdAt,
    }));

  const balance = await getLoyaltyBalance(clean).catch(() => null);
  if (balance) {
    const entries = await listLoyaltyEntries(clean).catch(() => []);
    out.loyalty = { ...balance, tier: balance.tier.name, entries };
  }

  const sub = await findSubscriptionByEmail(clean).catch(() => null);
  if (sub) {
    out.subscriptions = [{
      productId: sub.productId, status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd, createdAt: sub.createdAt,
    }];
  }
  return out;
}

// ─── Deletion execution (anonymisation) ──────────────────────────────────────

export interface DeletionSummary {
  ordersAnonymized: number;
  loyaltyDeleted: boolean;
  licensesAnonymized: number;
  consentsDeleted: number;
  subscriptionsAnonymized: number;
  wishlistAlertsDeleted: number;
  cartSnapshotsDeleted: number;
  dbMode: boolean;
}

async function editJsonFile<T>(file: string, fn: (list: T[]) => T[]): Promise<number> {
  const filePath = path.join(process.cwd(), ".data", file);
  let list: T[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as T[];
    if (Array.isArray(raw)) list = raw;
  } catch {
    return 0;
  }
  const next = fn(list);
  const changed = list.length - next.length;
  const mutated = JSON.stringify(next) !== JSON.stringify(list);
  if (changed !== 0 || mutated) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  }
  return changed;
}

/**
 * Execute a verified deletion for `email`. Invariants (unit-tested):
 * order COUNT and TOTALS are preserved; no store retains the raw email
 * or the original email hash afterwards.
 */
export async function executeDeletion(email: string): Promise<DeletionSummary> {
  const clean = email.trim().toLowerCase();
  const emailHash = hashSubject(clean);
  const tombEmail = tombstoneEmail(emailHash);
  const tombHash = tombstoneHash(emailHash);
  const summary: DeletionSummary = {
    ordersAnonymized: 0, loyaltyDeleted: false, licensesAnonymized: 0,
    consentsDeleted: 0, subscriptionsAnonymized: 0, wishlistAlertsDeleted: 0,
    cartSnapshotsDeleted: 0, dbMode: false,
  };

  const db = await getDb().catch(() => null);
  if (db) {
    summary.dbMode = true;
    try {
      const orders = await db.order.updateMany({ where: { email: clean }, data: { email: tombEmail } });
      summary.ordersAnonymized = orders.count;
      const licenses = await db.licenseKey.updateMany({ where: { emailHash }, data: { emailHash: tombHash } });
      summary.licensesAnonymized = licenses.count;
      const subs = await db.subscription.updateMany({
        where: { emailHash },
        data: { emailHash: tombHash, emailCipher: "" },
      });
      summary.subscriptionsAnonymized = subs.count;
      const consents = await db.consentRecord.deleteMany({ where: { subjectHash: emailHash } });
      summary.consentsDeleted = consents.count;
      const alerts = await db.wishlistAlert.deleteMany({ where: { emailHash } });
      summary.wishlistAlertsDeleted = alerts.count;
      const snaps = await db.cartSnapshot.deleteMany({ where: { emailHash } });
      summary.cartSnapshotsDeleted = snaps.count;
    } catch { /* file fallbacks below still apply for file-backed stores */ }
  }

  // The privacy requests for this person are re-keyed to the tombstone
  // too (and their ciphers scrubbed) — the request ledger must not keep
  // a linkable hash after the deletion it authorised has executed.
  if (db) {
    try {
      await db.privacyRequest.updateMany({
        where: { emailHash },
        data: { emailHash: tombHash, emailCipher: "" },
      });
    } catch { /* file pass below still applies */ }
  }
  await editJsonFile<{ emailHash: string; emailCipher: string }>("privacy-requests.json", (list) =>
    list.map((r) => (r.emailHash === emailHash ? { ...r, emailHash: tombHash, emailCipher: "" } : r)),
  );

  // File-backed stores (also the only stores in zero-DB mode).
  if (summary.licensesAnonymized === 0) {
    let touched = 0;
    await editJsonFile<{ emailHash: string }>("license-keys.json", (list) =>
      list.map((r) => {
        if (r.emailHash === emailHash) { touched++; return { ...r, emailHash: tombHash }; }
        return r;
      }),
    );
    summary.licensesAnonymized = touched;
  }
  if (summary.subscriptionsAnonymized === 0) {
    let touched = 0;
    await editJsonFile<{ emailHash: string; emailCipher: string }>("subscriptions.json", (list) =>
      list.map((r) => {
        if (r.emailHash === emailHash) { touched++; return { ...r, emailHash: tombHash, emailCipher: "" }; }
        return r;
      }),
    );
    summary.subscriptionsAnonymized = touched;
  }
  if (summary.wishlistAlertsDeleted === 0) {
    summary.wishlistAlertsDeleted = await editJsonFile<{ emailHash: string }>(
      "wishlist-alerts.json", (list) => list.filter((r) => r.emailHash !== emailHash),
    );
  }
  if (summary.cartSnapshotsDeleted === 0) {
    summary.cartSnapshotsDeleted = await editJsonFile<{ emailHash: string }>(
      "cart-snapshots.json", (list) => list.filter((r) => r.emailHash !== emailHash),
    );
  }

  const before = await getLoyaltyBalance(clean).catch(() => null);
  await deleteLoyaltyAccount(clean);
  summary.loyaltyDeleted = before != null;

  summary.consentsDeleted += deleteMemoryConsentFor(emailHash);
  return summary;
}

// ─── Consent preferences ─────────────────────────────────────────────────────

/**
 * Record consent preferences for the privacy center. A marketing
 * opt-out also writes the "email" channel opt-out — that is the exact
 * record feature 20's automation checks before sending (see
 * lib/email-automation.ts isOptedOut(to, "email")) — and a marketing
 * opt-in clears it again.
 */
export async function setConsentPreferences(
  email: string,
  prefs: { analytics: boolean; marketing: boolean },
): Promise<{ persisted: boolean }> {
  let persisted = true;
  for (const [channel, granted] of [["analytics", prefs.analytics], ["marketing", prefs.marketing]] as const) {
    const r = await recordConsent({ subject: email, channel, granted, storeCipher: false });
    persisted = persisted && r.persisted;
  }
  const mirror = await recordConsent({ subject: email, channel: "email", granted: prefs.marketing, storeCipher: false });
  persisted = persisted && mirror.persisted;
  return { persisted };
}

/** Current consent state for the preferences UI (latest record wins). */
export async function getConsentPreferences(email: string): Promise<{ analytics: boolean; marketing: boolean }> {
  const emailHash = hashSubject(email.trim().toLowerCase());
  const read = async (channel: string): Promise<boolean | null> => {
    const db = await getDb().catch(() => null);
    if (db) {
      try {
        const row = await db.consentRecord.findFirst({
          where: { subjectHash: emailHash, channel },
          orderBy: { createdAt: "desc" },
        });
        if (row) return row.granted;
      } catch { /* fall through */ }
    }
    const mine = memoryConsentEntries().filter((c) => c.subjectHash === emailHash && c.channel === channel);
    return mine.length ? mine[mine.length - 1].granted : null;
  };
  return {
    analytics: (await read("analytics")) ?? true,
    marketing: (await read("marketing")) ?? true,
  };
}

// ─── Retention cleanup ───────────────────────────────────────────────────────

/** Expire stale pending requests and scrub done requests past retention. */
export async function cleanupPrivacyRequests(retentionDays: number, now = new Date()): Promise<{ expired: number; scrubbed: number }> {
  let expired = 0;
  let scrubbed = 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600 * 1000);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const exp = await db.privacyRequest.updateMany({
        where: { status: "pending", expiresAt: { lt: now } },
        data: { status: "expired" },
      });
      expired = exp.count;
      const scr = await db.privacyRequest.updateMany({
        where: { status: "done", executedAt: { lt: cutoff }, emailCipher: { not: "" } },
        data: { emailCipher: "" },
      });
      scrubbed = scr.count;
      return { expired, scrubbed };
    } catch { /* fall through */ }
  }
  const all = await readFileRequests();
  let dirty = false;
  for (const r of all) {
    if (r.status === "pending" && new Date(r.expiresAt) < now) { r.status = "expired"; expired++; dirty = true; }
    if (r.status === "done" && r.executedAt && new Date(r.executedAt) < cutoff && r.emailCipher) {
      r.emailCipher = ""; scrubbed++; dirty = true;
    }
  }
  if (dirty) await writeFileRequests(all);
  return { expired, scrubbed };
}
