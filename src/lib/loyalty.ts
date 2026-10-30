/**
 * Loyalty points (Phase 4, feature 11). Flag `loyalty` — default OFF.
 *
 * Model: an account per customer email (stored as SHA-256 hash +
 * optional AES-GCM ciphertext) and an append-only ledger of entries
 * (earn / spend / expire / adjust). EVERY money-relevant rule is pure
 * and unit-tested:
 *
 *  - Earn: floor(orderTotalUSD × earnPerUSD × tier multiplier), where
 *    the tier comes from lifetime earnings BEFORE this order.
 *  - Redeem: capped server-side at maxRedeemPercent of the order total
 *    AND at the account balance — the client's requested points are
 *    only ever a ceiling request, never the authority.
 *  - Idempotency: every entry carries a unique key (earn:<orderId>,
 *    spend:<orderId>, expire:<earnKey>); replaying an order's earn or
 *    spend returns the original entry and moves nothing.
 *  - Expiry: earn entries older than expiryDays are expired by the
 *    ledger job logic (expireOldEntries), never below a zero balance.
 *
 * Persistence: LoyaltyAccount/LoyaltyEntry tables when a DB is
 * configured, else .data/loyalty.json.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { encryptPii, hashSubject, piiConfigured } from "./pii.ts";
import { round2 } from "./byo.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

export interface LoyaltyTier {
  name: string;
  minLifetime: number;
  multiplier: number;
}

export interface LoyaltyConfig {
  earnPerUSD: number;
  tiers: LoyaltyTier[];
  maxRedeemPercent: number; // max share of an order total payable in points
  pointValueUSD: number; // cash value of one point when redeeming
  expiryDays: number;
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  earnPerUSD: 1,
  tiers: [
    { name: "Bronze", minLifetime: 0, multiplier: 1 },
    { name: "Silver", minLifetime: 500, multiplier: 1.25 },
    { name: "Gold", minLifetime: 2000, multiplier: 1.5 },
  ],
  maxRedeemPercent: 30,
  pointValueUSD: 0.01,
  expiryDays: 365,
};

export function sanitizeLoyaltyConfig(raw: unknown): LoyaltyConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_LOYALTY_CONFIG;
  const c = raw as Partial<LoyaltyConfig>;
  const tiers = Array.isArray(c.tiers)
    ? c.tiers
        .filter((t): t is LoyaltyTier => Boolean(t) && typeof t === "object")
        .map((t) => ({
          name: String(t.name ?? "Tier").slice(0, 24) || "Tier",
          minLifetime: Math.max(0, Math.floor(Number(t.minLifetime) || 0)),
          multiplier: Math.min(5, Math.max(0.1, Number(t.multiplier) || 1)),
        }))
        .sort((a, b) => a.minLifetime - b.minLifetime)
    : [];
  return {
    earnPerUSD: Math.min(100, Math.max(0, Number(c.earnPerUSD) || 0)) || DEFAULT_LOYALTY_CONFIG.earnPerUSD,
    tiers: tiers.length > 0 ? tiers : DEFAULT_LOYALTY_CONFIG.tiers,
    maxRedeemPercent: Math.min(90, Math.max(0, Number(c.maxRedeemPercent) || 0)),
    pointValueUSD: Math.min(1, Math.max(0.0001, Number(c.pointValueUSD) || DEFAULT_LOYALTY_CONFIG.pointValueUSD)),
    expiryDays: Math.min(3650, Math.max(1, Math.floor(Number(c.expiryDays) || DEFAULT_LOYALTY_CONFIG.expiryDays))),
  };
}

export async function getLoyaltyConfig(): Promise<LoyaltyConfig> {
  return getJsonConfig<LoyaltyConfig>("loyalty_config", "loyalty-config.json", sanitizeLoyaltyConfig, DEFAULT_LOYALTY_CONFIG);
}

export async function setLoyaltyConfig(config: LoyaltyConfig): Promise<{ persisted: "db" | "file"; value: LoyaltyConfig }> {
  return setJsonConfig("loyalty_config", "loyalty-config.json", config, sanitizeLoyaltyConfig);
}

// ─── Pure math ───────────────────────────────────────────────────────────────

/** The tier a customer is in for a given lifetime-earned total. */
export function tierFor(config: LoyaltyConfig, lifetimeEarned: number): LoyaltyTier {
  let current = config.tiers[0] ?? { name: "Bronze", minLifetime: 0, multiplier: 1 };
  for (const tier of config.tiers) {
    if (lifetimeEarned >= tier.minLifetime) current = tier;
  }
  return current;
}

/** Points earned by a completed order (tier from pre-order lifetime). */
export function earnPointsFor(config: LoyaltyConfig, orderTotalUSD: number, lifetimeEarnedBefore: number): number {
  if (orderTotalUSD <= 0) return 0;
  const tier = tierFor(config, lifetimeEarnedBefore);
  return Math.floor(orderTotalUSD * config.earnPerUSD * tier.multiplier);
}

export interface Redemption {
  points: number;
  valueUSD: number;
}

/**
 * Server-side redemption: never more points than the balance, never
 * more value than maxRedeemPercent of the order total (pure).
 */
export function redemptionFor(
  config: LoyaltyConfig,
  balance: number,
  requestedPoints: number,
  orderTotalUSD: number,
): Redemption {
  const capUSD = round2(Math.max(0, orderTotalUSD) * (config.maxRedeemPercent / 100));
  let points = Math.max(0, Math.min(Math.floor(requestedPoints) || 0, Math.max(0, balance)));
  let valueUSD = round2(points * config.pointValueUSD);
  if (valueUSD > capUSD) {
    points = Math.floor(capUSD / config.pointValueUSD);
    valueUSD = round2(points * config.pointValueUSD);
  }
  return { points, valueUSD };
}

// ─── Store (DB → .data fallback) ─────────────────────────────────────────────

export interface LoyaltyEntryRecord {
  id: string;
  kind: "earn" | "spend" | "expire" | "adjust";
  points: number; // signed delta
  orderId: string | null;
  idempotencyKey: string;
  balanceAfter: number;
  createdAt: string; // ISO
}

export interface LoyaltyAccountRecord {
  id: string;
  emailHash: string;
  emailCipher: string;
  balance: number;
  lifetimeEarned: number;
  createdAt: string;
  entries: LoyaltyEntryRecord[];
}

const STORE_PATH = path.join(process.cwd(), ".data", "loyalty.json");

async function readStore(): Promise<LoyaltyAccountRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as LoyaltyAccountRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeStore(list: LoyaltyAccountRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

function emailHashOf(email: string): string {
  return hashSubject(email.trim().toLowerCase());
}

export interface LoyaltyBalance {
  balance: number;
  lifetimeEarned: number;
  tier: LoyaltyTier;
}

export async function getLoyaltyBalance(email: string, config?: LoyaltyConfig): Promise<LoyaltyBalance | null> {
  const cfg = config ?? (await getLoyaltyConfig());
  const emailHash = emailHashOf(email);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.loyaltyAccount.findUnique({ where: { emailHash } });
      if (row) return { balance: row.balance, lifetimeEarned: row.lifetimeEarned, tier: tierFor(cfg, row.lifetimeEarned) };
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  const account = all.find((a) => a.emailHash === emailHash);
  if (!account) return null;
  return { balance: account.balance, lifetimeEarned: account.lifetimeEarned, tier: tierFor(cfg, account.lifetimeEarned) };
}

async function appendEntryDb(
  email: string,
  entry: Omit<LoyaltyEntryRecord, "id" | "createdAt" | "balanceAfter">,
): Promise<{ applied: boolean; entry: LoyaltyEntryRecord } | null> {
  const db = await getDb().catch(() => null);
  if (!db) return null;
  try {
    const emailHash = emailHashOf(email);
    const existing = await db.loyaltyEntry.findUnique({ where: { idempotencyKey: entry.idempotencyKey } });
    if (existing) {
      return {
        applied: false,
        entry: {
          id: existing.id, kind: existing.kind as LoyaltyEntryRecord["kind"], points: existing.points,
          orderId: existing.orderId, idempotencyKey: existing.idempotencyKey,
          balanceAfter: existing.balanceAfter, createdAt: existing.createdAt.toISOString(),
        },
      };
    }
    const account = await db.loyaltyAccount.upsert({
      where: { emailHash },
      create: { emailHash, emailCipher: piiConfigured() ? encryptPii(email.trim().toLowerCase()) : "" },
      update: {},
    });
    const balanceAfter = Math.max(0, account.balance + entry.points);
    const created = await db.loyaltyEntry.create({
      data: {
        accountId: account.id, kind: entry.kind, points: entry.points,
        orderId: entry.orderId, idempotencyKey: entry.idempotencyKey, balanceAfter,
      },
    });
    await db.loyaltyAccount.update({
      where: { id: account.id },
      data: {
        balance: balanceAfter,
        lifetimeEarned: entry.kind === "earn" ? account.lifetimeEarned + Math.max(0, entry.points) : account.lifetimeEarned,
      },
    });
    return {
      applied: true,
      entry: {
        id: created.id, kind: entry.kind, points: entry.points, orderId: entry.orderId,
        idempotencyKey: entry.idempotencyKey, balanceAfter, createdAt: created.createdAt.toISOString(),
      },
    };
  } catch {
    return null;
  }
}

async function appendEntryFile(
  email: string,
  entry: Omit<LoyaltyEntryRecord, "id" | "createdAt" | "balanceAfter">,
): Promise<{ applied: boolean; entry: LoyaltyEntryRecord }> {
  const all = await readStore();
  const emailHash = emailHashOf(email);
  let account = all.find((a) => a.emailHash === emailHash);
  if (account) {
    const existing = account.entries.find((e) => e.idempotencyKey === entry.idempotencyKey);
    if (existing) return { applied: false, entry: existing };
  }
  if (!account) {
    account = {
      id: randomUUID(), emailHash,
      emailCipher: piiConfigured() ? encryptPii(email.trim().toLowerCase()) : "",
      balance: 0, lifetimeEarned: 0, createdAt: new Date().toISOString(), entries: [],
    };
    all.push(account);
  }
  const balanceAfter = Math.max(0, account.balance + entry.points);
  const record: LoyaltyEntryRecord = {
    id: randomUUID(), kind: entry.kind, points: entry.points, orderId: entry.orderId,
    idempotencyKey: entry.idempotencyKey, balanceAfter, createdAt: new Date().toISOString(),
  };
  account.entries.push(record);
  account.balance = balanceAfter;
  if (entry.kind === "earn") account.lifetimeEarned += Math.max(0, entry.points);
  await writeStore(all);
  return { applied: true, entry: record };
}

async function appendEntry(
  email: string,
  entry: Omit<LoyaltyEntryRecord, "id" | "createdAt" | "balanceAfter">,
): Promise<{ applied: boolean; entry: LoyaltyEntryRecord }> {
  return (await appendEntryDb(email, entry)) ?? appendEntryFile(email, entry);
}

// ─── Operations ──────────────────────────────────────────────────────────────

/** Earn points for a completed order — idempotent per order. */
export async function earnForOrder(
  email: string,
  orderId: string,
  orderTotalUSD: number,
): Promise<{ points: number; applied: boolean }> {
  const config = await getLoyaltyConfig();
  const before = await getLoyaltyBalance(email, config);
  const points = earnPointsFor(config, orderTotalUSD, before?.lifetimeEarned ?? 0);
  if (points <= 0) return { points: 0, applied: false };
  const res = await appendEntry(email, {
    kind: "earn", points, orderId, idempotencyKey: `earn:${orderId}`,
  });
  return { points: res.entry.points, applied: res.applied };
}

/** Read-only redemption preview — drives the checkout total (no write). */
export async function previewRedemption(
  email: string,
  requestedPoints: number,
  orderTotalUSD: number,
): Promise<Redemption> {
  const config = await getLoyaltyConfig();
  const balance = await getLoyaltyBalance(email, config);
  return redemptionFor(config, balance?.balance ?? 0, requestedPoints, orderTotalUSD);
}

/**
 * Commit a previously previewed spend — idempotent per order. Called
 * only once the payment session exists, so a failed/unconfigured
 * checkout never burns points.
 */
export async function commitSpendForOrder(
  email: string,
  orderId: string,
  points: number,
): Promise<{ points: number; valueUSD: number; applied: boolean }> {
  if (points <= 0) return { points: 0, valueUSD: 0, applied: false };
  const config = await getLoyaltyConfig();
  const res = await appendEntry(email, {
    kind: "spend", points: -points, orderId, idempotencyKey: `spend:${orderId}`,
  });
  const appliedPoints = Math.abs(res.entry.points);
  return { points: appliedPoints, valueUSD: round2(appliedPoints * config.pointValueUSD), applied: res.applied };
}

/**
 * Spend points against an order at checkout — idempotent per order and
 * capped server-side by redemptionFor(): the requested amount can only
 * ever reduce what is actually applied. (preview + commit in one call.)
 */
export async function spendForOrder(
  email: string,
  orderId: string,
  requestedPoints: number,
  orderTotalUSD: number,
): Promise<{ points: number; valueUSD: number; applied: boolean }> {
  const redemption = await previewRedemption(email, requestedPoints, orderTotalUSD);
  if (redemption.points <= 0) return { points: 0, valueUSD: 0, applied: false };
  return commitSpendForOrder(email, orderId, redemption.points);
}

/** Full ledger for one customer (account page / admin inspection). */
export async function listLoyaltyEntries(email: string): Promise<LoyaltyEntryRecord[]> {
  const emailHash = emailHashOf(email);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const account = await db.loyaltyAccount.findUnique({ where: { emailHash }, include: { entries: { orderBy: { createdAt: "asc" } } } });
      if (account) {
        return account.entries.map((e) => ({
          id: e.id, kind: e.kind as LoyaltyEntryRecord["kind"], points: e.points, orderId: e.orderId,
          idempotencyKey: e.idempotencyKey, balanceAfter: e.balanceAfter, createdAt: e.createdAt.toISOString(),
        }));
      }
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  return all.find((a) => a.emailHash === emailHash)?.entries ?? [];
}

/**
 * Expire earn entries older than the configured expiry. Each expiry is
 * its own idempotent ledger entry; the balance never drops below zero.
 * Returns how many expire entries were written.
 */
export async function expireOldEntries(now: Date = new Date()): Promise<number> {
  const config = await getLoyaltyConfig();
  const cutoff = now.getTime() - config.expiryDays * 24 * 3600 * 1000;
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const accounts = await db.loyaltyAccount.findMany({ include: { entries: true } });
      if (accounts.length > 0) {
        let written = 0;
        for (const account of accounts) {
          let balance = account.balance;
          const expiredKeys = new Set(
            account.entries.filter((e) => e.kind === "expire").map((e) => e.idempotencyKey),
          );
          for (const earn of account.entries.filter((e) => e.kind === "earn")) {
            const key = `expire:${earn.idempotencyKey}`;
            if (expiredKeys.has(key) || earn.createdAt.getTime() > cutoff) continue;
            const amount = Math.min(earn.points, balance);
            if (amount <= 0) continue;
            balance -= amount;
            await db.loyaltyEntry.create({
              data: {
                accountId: account.id, kind: "expire", points: -amount,
                orderId: earn.orderId, idempotencyKey: key, balanceAfter: balance,
              },
            });
            written++;
          }
          if (balance !== account.balance) {
            await db.loyaltyAccount.update({ where: { id: account.id }, data: { balance } });
          }
        }
        return written;
      }
    } catch {
      // fall through to the file store
    }
  }
  const all = await readStore();
  let written = 0;
  let dirty = false;
  for (const account of all) {
    const expiredKeys = new Set(
      account.entries.filter((e) => e.kind === "expire").map((e) => e.idempotencyKey),
    );
    for (const earn of account.entries.filter((e) => e.kind === "earn")) {
      const key = `expire:${earn.idempotencyKey}`;
      if (expiredKeys.has(key)) continue;
      if (new Date(earn.createdAt).getTime() > cutoff) continue;
      const amount = Math.min(earn.points, account.balance);
      if (amount <= 0) continue;
      account.balance -= amount;
      account.entries.push({
        id: randomUUID(), kind: "expire", points: -amount, orderId: earn.orderId,
        idempotencyKey: key, balanceAfter: account.balance, createdAt: now.toISOString(),
      });
      written++;
      dirty = true;
    }
  }
  if (dirty) await writeStore(all);
  return written;
}

/** Cleanup helper (admin/tests): remove one account entirely. */
export async function deleteLoyaltyAccount(email: string): Promise<void> {
  const emailHash = emailHashOf(email);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.loyaltyAccount.delete({ where: { emailHash } });
      return;
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  await writeStore(all.filter((a) => a.emailHash !== emailHash));
}
