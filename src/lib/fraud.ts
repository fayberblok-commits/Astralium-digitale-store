/**
 * Fraud shield (Phase 5, feature 19). Flag `fraud_shield` — default ON,
 * review-only safe defaults: NOTHING is auto-refunded or auto-banned.
 *
 *  - Risk scoring is a PURE function (scoreRisk) over server-side signals:
 *    disposable email domain, checkout velocity per email/IP (hashes),
 *    amount anomaly, repeated failed attempts. No third-party calls, no
 *    external blocklists fetched at runtime — the disposable-domain list
 *    ships in code and is deliberately small and well-known.
 *  - Orders scoring at/above the threshold (default 60, owner-tunable)
 *    become FraudHold rows: payment stands, DELIVERY PAUSES (webhook
 *    fulfilment skips, download route refuses) until the owner approves
 *    (release → delivery re-issued) or rejects (owner refunds manually
 *    in the provider dashboard — stated in the admin UI, never hidden).
 *  - The blacklist is hash-only (SHA-256 of the email) and is enforced
 *    at checkout before any payment session is created.
 *
 * Persistence: DB tables when configured, else .data/fraud-*.json.
 * Only hashes of emails/IPs are ever stored or logged.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { decryptPii, encryptPii, hashSubject, piiConfigured } from "./pii.ts";
import { hashEmail } from "./reviews.ts";
import { recordOwnerEvent } from "./owner-alerts.ts";

// ─── Pure risk scoring ───────────────────────────────────────────────────────

/** Well-known disposable/throwaway email domains (small, curated). */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "mailinator2.com", "guerrillamail.com", "guerrillamail.net",
  "guerrillamail.org", "sharklasers.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "trashmail.com",
  "fakeinbox.com", "getnada.com", "nada.email", "maildrop.cc", "dispostable.com",
  "mohmal.com", "emailondeck.com", "mintemail.com", "mytemp.email",
  "tempinbox.com", "spamgourmet.com", "mailnesia.com", "incognitomail.org",
  "discard.email", "disposablemail.com", "pokemail.net", "bccto.me",
  "mailcatch.com", "jetable.org", "1secmail.com", "1secmail.net",
  "wwjmp.com", "esiix.com", "xojxe.com", "yoggm.com",
]);

export function emailDomain(email: string): string {
  return (email.split("@")[1] ?? "").trim().toLowerCase();
}

export function isDisposableEmail(email: string): boolean {
  return DISPOSABLE_DOMAINS.has(emailDomain(email));
}

export interface FraudSignals {
  disposableDomain: boolean;
  /** Checkouts (incl. this one) by this email in the last hour. */
  checkoutsLastHourByEmail: number;
  /** Checkouts (incl. this one) from this IP in the last hour. */
  checkoutsLastHourByIp: number;
  /** Failed payment attempts by this email in the last 24h. */
  failedLast24hByEmail: number;
  amountUSD: number;
}

export interface RiskVerdict {
  score: number; // 0..100
  reasons: string[];
}

/** Pure + deterministic — the whole scoring policy lives here, unit-tested. */
export function scoreRisk(s: FraudSignals): RiskVerdict {
  let score = 0;
  const reasons: string[] = [];
  if (s.disposableDomain) { score += 40; reasons.push("DISPOSABLE_EMAIL"); }
  if (s.checkoutsLastHourByEmail >= 5) { score += 35; reasons.push("EMAIL_VELOCITY_HIGH"); }
  else if (s.checkoutsLastHourByEmail >= 3) { score += 20; reasons.push("EMAIL_VELOCITY"); }
  if (s.checkoutsLastHourByIp >= 10) { score += 30; reasons.push("IP_VELOCITY_HIGH"); }
  else if (s.checkoutsLastHourByIp >= 5) { score += 15; reasons.push("IP_VELOCITY"); }
  if (s.amountUSD > 750) { score += 30; reasons.push("AMOUNT_ANOMALY_HIGH"); }
  else if (s.amountUSD > 250) { score += 15; reasons.push("AMOUNT_ANOMALY"); }
  if (s.failedLast24hByEmail >= 4) { score += 35; reasons.push("REPEATED_FAILURES_HIGH"); }
  else if (s.failedLast24hByEmail >= 2) { score += 20; reasons.push("REPEATED_FAILURES"); }
  return { score: Math.min(100, score), reasons };
}

// ─── Configuration ───────────────────────────────────────────────────────────

export interface FraudConfig {
  threshold: number; // score at/above which an order is held
}

export const EMPTY_FRAUD_CONFIG: FraudConfig = { threshold: 60 };

export function sanitizeFraudConfig(raw: unknown): FraudConfig {
  const t = Math.floor(Number((raw as Partial<FraudConfig>)?.threshold));
  return { threshold: Number.isFinite(t) ? Math.min(100, Math.max(10, t)) : 60 };
}

export async function getFraudConfig(): Promise<FraudConfig> {
  return getJsonConfig("fraud_config", "fraud-config.json", sanitizeFraudConfig, EMPTY_FRAUD_CONFIG);
}

export async function setFraudConfig(value: FraudConfig): Promise<{ persisted: "db" | "file"; value: FraudConfig }> {
  return setJsonConfig("fraud_config", "fraud-config.json", value, sanitizeFraudConfig);
}

// ─── Events (velocity telemetry, hash-only) ──────────────────────────────────

export interface FraudEventRecord {
  id: string;
  emailHash: string;
  ipHash: string;
  amountUSD: number;
  outcome: "checkout" | "failed";
  createdAt: string;
}

const EVENTS_PATH = path.join(process.cwd(), ".data", "fraud-events.json");
const EVENT_RETENTION_MS = 48 * 3600 * 1000;

async function readEvents(): Promise<FraudEventRecord[]> {
  try {
    return JSON.parse(await fs.readFile(EVENTS_PATH, "utf8")) as FraudEventRecord[];
  } catch {
    return [];
  }
}

async function writeEvents(list: FraudEventRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(EVENTS_PATH), { recursive: true });
  await fs.writeFile(EVENTS_PATH, JSON.stringify(list, null, 2), "utf8");
}

export function hashIp(ip: string): string {
  return hashSubject(ip.trim());
}

export async function recordFraudEvent(input: {
  email: string;
  ip: string;
  amountUSD: number;
  outcome: "checkout" | "failed";
}): Promise<void> {
  const rec: FraudEventRecord = {
    id: randomUUID(),
    emailHash: hashEmail(input.email),
    ipHash: hashIp(input.ip || "unknown"),
    amountUSD: Math.max(0, input.amountUSD),
    outcome: input.outcome,
    createdAt: new Date().toISOString(),
  };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.fraudEvent.create({
        data: { emailHash: rec.emailHash, ipHash: rec.ipHash, amountUSD: rec.amountUSD, outcome: rec.outcome },
      });
      return;
    } catch { /* fall through to file */ }
  }
  const all = await readEvents();
  const cutoff = Date.now() - EVENT_RETENTION_MS;
  const kept = all.filter((e) => new Date(e.createdAt).getTime() > cutoff);
  kept.push(rec);
  await writeEvents(kept);
}

export interface VelocityCounts {
  byEmailHour: number;
  byIpHour: number;
  failedByEmailDay: number;
}

/** Counts INCLUDING the just-recorded current event (call after recording). */
export async function velocityCounts(email: string, ip: string, now = new Date()): Promise<VelocityCounts> {
  const emailHash = hashEmail(email);
  const ipHash = hashIp(ip || "unknown");
  const hourAgo = new Date(now.getTime() - 3600 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const [byEmailHour, byIpHour, failedByEmailDay] = await Promise.all([
        db.fraudEvent.count({ where: { emailHash, outcome: "checkout", createdAt: { gte: hourAgo } } }),
        db.fraudEvent.count({ where: { ipHash, outcome: "checkout", createdAt: { gte: hourAgo } } }),
        db.fraudEvent.count({ where: { emailHash, outcome: "failed", createdAt: { gte: dayAgo } } }),
      ]);
      return { byEmailHour, byIpHour, failedByEmailDay };
    } catch { /* fall through to file */ }
  }
  const all = await readEvents();
  const inHour = (e: FraudEventRecord) => new Date(e.createdAt).getTime() >= hourAgo.getTime();
  const inDay = (e: FraudEventRecord) => new Date(e.createdAt).getTime() >= dayAgo.getTime();
  return {
    byEmailHour: all.filter((e) => e.emailHash === emailHash && e.outcome === "checkout" && inHour(e)).length,
    byIpHour: all.filter((e) => e.ipHash === ipHash && e.outcome === "checkout" && inHour(e)).length,
    failedByEmailDay: all.filter((e) => e.emailHash === emailHash && e.outcome === "failed" && inDay(e)).length,
  };
}

// ─── Blacklist (hash-only) ───────────────────────────────────────────────────

export interface BlacklistRecord {
  id: string;
  emailHash: string;
  reason: string;
  createdAt: string;
}

const BLACKLIST_PATH = path.join(process.cwd(), ".data", "fraud-blacklist.json");

async function readBlacklist(): Promise<BlacklistRecord[]> {
  try {
    return JSON.parse(await fs.readFile(BLACKLIST_PATH, "utf8")) as BlacklistRecord[];
  } catch {
    return [];
  }
}

async function writeBlacklist(list: BlacklistRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(BLACKLIST_PATH), { recursive: true });
  await fs.writeFile(BLACKLIST_PATH, JSON.stringify(list, null, 2), "utf8");
}

export async function isBlacklisted(email: string): Promise<boolean> {
  const emailHash = hashEmail(email);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.fraudBlacklist.findUnique({ where: { emailHash } });
      if (row) return true;
    } catch { /* fall through */ }
  }
  return (await readBlacklist()).some((b) => b.emailHash === emailHash);
}

export async function listBlacklist(): Promise<BlacklistRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.fraudBlacklist.findMany({ orderBy: { createdAt: "desc" } });
      if (rows.length > 0) {
        return rows.map((r) => ({ id: r.id, emailHash: r.emailHash, reason: r.reason, createdAt: r.createdAt.toISOString() }));
      }
    } catch { /* fall through */ }
  }
  return readBlacklist();
}

export async function addToBlacklist(email: string, reason = ""): Promise<{ persisted: "db" | "file"; record: BlacklistRecord }> {
  const record: BlacklistRecord = {
    id: randomUUID(),
    emailHash: hashEmail(email),
    reason: reason.slice(0, 200),
    createdAt: new Date().toISOString(),
  };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.fraudBlacklist.upsert({
        where: { emailHash: record.emailHash },
        create: { emailHash: record.emailHash, reason: record.reason },
        update: { reason: record.reason },
      });
      return { persisted: "db", record: { ...record, id: row.id, createdAt: row.createdAt.toISOString() } };
    } catch { /* fall through */ }
  }
  const all = await readBlacklist();
  const idx = all.findIndex((b) => b.emailHash === record.emailHash);
  if (idx >= 0) all[idx] = { ...all[idx], reason: record.reason };
  else all.push(record);
  await writeBlacklist(all);
  return { persisted: "file", record };
}

export async function removeFromBlacklist(id: string): Promise<{ ok: boolean }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.fraudBlacklist.delete({ where: { id } });
      return { ok: true };
    } catch { /* fall through */ }
  }
  const all = await readBlacklist();
  const next = all.filter((b) => b.id !== id);
  if (next.length === all.length) return { ok: false };
  await writeBlacklist(next);
  return { ok: true };
}

// ─── Holds ───────────────────────────────────────────────────────────────────

export interface FraudHoldRecord {
  id: string;
  orderId: string;
  emailHash: string;
  emailCipher: string;
  score: number;
  reasons: string[];
  status: "pending" | "released" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
}

const HOLDS_PATH = path.join(process.cwd(), ".data", "fraud-holds.json");

async function readHolds(): Promise<FraudHoldRecord[]> {
  try {
    return JSON.parse(await fs.readFile(HOLDS_PATH, "utf8")) as FraudHoldRecord[];
  } catch {
    return [];
  }
}

async function writeHolds(list: FraudHoldRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(HOLDS_PATH), { recursive: true });
  await fs.writeFile(HOLDS_PATH, JSON.stringify(list, null, 2), "utf8");
}

type HoldRow = {
  id: string; orderId: string; emailHash: string; emailCipher: string; score: number;
  reasons: string[]; status: string; createdAt: Date; resolvedAt: Date | null;
};

function holdFromRow(r: HoldRow): FraudHoldRecord {
  return {
    id: r.id, orderId: r.orderId, emailHash: r.emailHash, emailCipher: r.emailCipher,
    score: r.score, reasons: [...r.reasons],
    status: r.status === "released" || r.status === "rejected" ? r.status : "pending",
    createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}

async function saveHold(rec: FraudHoldRecord): Promise<void> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.fraudHold.upsert({
        where: { orderId: rec.orderId },
        create: {
          id: rec.id, orderId: rec.orderId, emailHash: rec.emailHash, emailCipher: rec.emailCipher,
          score: rec.score, reasons: rec.reasons, status: rec.status,
          resolvedAt: rec.resolvedAt ? new Date(rec.resolvedAt) : null,
        },
        update: { status: rec.status, resolvedAt: rec.resolvedAt ? new Date(rec.resolvedAt) : null },
      });
      return;
    } catch { /* fall through */ }
  }
  const all = await readHolds();
  const idx = all.findIndex((h) => h.orderId === rec.orderId);
  if (idx >= 0) all[idx] = rec; else all.push(rec);
  await writeHolds(all);
}

export async function getHold(orderId: string): Promise<FraudHoldRecord | null> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.fraudHold.findUnique({ where: { orderId } });
      if (row) return holdFromRow(row);
    } catch { /* fall through */ }
  }
  return (await readHolds()).find((h) => h.orderId === orderId) ?? null;
}

/** Delivery/download gate: true only while a hold is PENDING. */
export async function isOrderHeld(orderId: string): Promise<boolean> {
  const hold = await getHold(orderId);
  return hold?.status === "pending";
}

export async function listHolds(status?: FraudHoldRecord["status"]): Promise<FraudHoldRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.fraudHold.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      if (rows.length > 0) return rows.map(holdFromRow);
    } catch { /* fall through */ }
  }
  return (await readHolds())
    .filter((h) => !status || h.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);
}

export async function resolveHold(
  id: string,
  action: "released" | "rejected",
): Promise<FraudHoldRecord | null> {
  const all = await readHolds();
  let rec = all.find((h) => h.id === id) ?? null;
  if (!rec) {
    const db = await getDb().catch(() => null);
    if (db) {
      try {
        const row = await db.fraudHold.findUnique({ where: { id } });
        if (row) rec = holdFromRow(row);
      } catch { /* handled below */ }
    }
  }
  if (!rec || rec.status !== "pending") return null;
  rec = { ...rec, status: action, resolvedAt: new Date().toISOString() };
  await saveHold(rec);
  return rec;
}

/** Recover the buyer email for a hold release (null without PII key/cipher). */
export function holdBuyerEmail(hold: FraudHoldRecord): string | null {
  if (!hold.emailCipher || !piiConfigured()) return null;
  return decryptPii(hold.emailCipher);
}

// ─── Checkout assessment ─────────────────────────────────────────────────────

export type Assessment =
  | { blocked: true }
  | { blocked: false; held: boolean; score: number; reasons: string[] };

/**
 * Full checkout-completion assessment: blacklist first (hard refuse),
 * then record the event, score with fresh velocity counts, and create a
 * pending hold when the score crosses the threshold.
 */
export async function assessCheckout(input: {
  orderId: string;
  email: string;
  ip: string;
  amountUSD: number;
}): Promise<Assessment> {
  if (await isBlacklisted(input.email)) return { blocked: true };
  await recordFraudEvent({ email: input.email, ip: input.ip, amountUSD: input.amountUSD, outcome: "checkout" });
  const counts = await velocityCounts(input.email, input.ip);
  const verdict = scoreRisk({
    disposableDomain: isDisposableEmail(input.email),
    checkoutsLastHourByEmail: counts.byEmailHour,
    checkoutsLastHourByIp: counts.byIpHour,
    failedLast24hByEmail: counts.failedByEmailDay,
    amountUSD: input.amountUSD,
  });
  const config = await getFraudConfig();
  const held = verdict.score >= config.threshold;
  if (held) {
    const existing = await getHold(input.orderId);
    if (!existing) {
      await saveHold({
        id: randomUUID(),
        orderId: input.orderId,
        emailHash: hashEmail(input.email),
        emailCipher: piiConfigured() ? encryptPii(input.email) : "",
        score: verdict.score,
        reasons: verdict.reasons,
        status: "pending",
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      });
      // Phase 6, feature 26: a new fraud hold notifies the owner.
      void recordOwnerEvent({
        kind: "fraud_hold",
        title: `Fraud hold on order ${input.orderId} (score ${verdict.score})`,
        detail: { orderId: input.orderId, score: verdict.score, reasons: verdict.reasons },
      });
    }
  }
  return { blocked: false, held, score: verdict.score, reasons: verdict.reasons };
}

/** Record a failed payment attempt (provider refused/errored). */
export async function recordFailedAttempt(input: { email: string; ip: string }): Promise<void> {
  await recordFraudEvent({ email: input.email, ip: input.ip, amountUSD: 0, outcome: "failed" });
}
