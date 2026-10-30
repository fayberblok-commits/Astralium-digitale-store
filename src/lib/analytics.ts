/**
 * Privacy-first analytics (Phase 6, feature 27). Flag `analytics` —
 * default OFF (it observes visitors; the owner enables it explicitly).
 *
 * Privacy contract, enforced in this module:
 *  - NO raw IP is ever stored. The visitor identifier persisted is
 *    sha256(salt(day) | ip | user-agent) — the salt rotates daily, so
 *    the same visitor has a different hash tomorrow and cross-day
 *    tracking is impossible by construction.
 *  - An optional persistent visitor id (random, client-held) is only
 *    accepted when the visitor granted analytics consent, and is still
 *    only stored as a SHA-256 hash.
 *  - Country comes from the platform's country header
 *    (cf-ipcountry / x-vercel-ip-country) and is stored as a 2-letter
 *    code only. No third-party trackers, no cookies set by the
 *    endpoint unless a consent-gated visitor id is in play.
 *  - Consent denial (the `astralium-consent` cookie written by the
 *    privacy center / cookie banner) drops the event entirely.
 *
 * Storage: AnalyticsEvent table, else .data/analytics-events.json
 * (capped + pruned by the retention job). Aggregations are pure
 * functions over the stored records — unit-tested without a database.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";

export const ANALYTICS_TYPES = ["pageview", "product_view", "add_to_cart", "checkout_start", "purchase"] as const;
export type AnalyticsEventType = (typeof ANALYTICS_TYPES)[number];

export interface AnalyticsEventRecord {
  id: string;
  type: AnalyticsEventType;
  productId: string | null;
  path: string | null;
  country: string | null;
  visitorHash: string | null;
  day: string; // YYYY-MM-DD (UTC)
  createdAt: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "analytics-events.json");
const FILE_CAP = 50_000;

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Daily-rotating salt: derived from an optional env salt + the UTC day. */
export function dailySalt(day: string): string {
  const base = process.env.ANALYTICS_SALT || process.env.DOWNLOAD_SIGNING_SECRET || "astralium-analytics";
  return createHash("sha256").update(`${base}:${day}`).digest("hex");
}

/**
 * The only visitor identifier we store: a salted hash of (ip, UA) that
 * changes every UTC day. Returns null when no IP is available (the
 * event is still counted, just without a visitor dimension).
 */
export function hashVisitor(ip: string | null, userAgent: string | null, at: Date = new Date()): string | null {
  if (!ip) return null;
  const day = utcDay(at);
  return createHash("sha256").update(`${dailySalt(day)}|${ip}|${userAgent ?? ""}`).digest("hex").slice(0, 32);
}

/** Hash of the consent-gated persistent visitor id (never stored raw). */
export function hashPersistentVisitor(visitorId: string): string {
  return createHash("sha256").update(`vid:${visitorId}`).digest("hex").slice(0, 32);
}

/** Country code from platform headers; codes only, junk → null. */
export function countryFromHeaders(get: (name: string) => string | null): string | null {
  const raw = get("cf-ipcountry") ?? get("x-vercel-ip-country");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  return code;
}

/**
 * Consent gate: the `astralium-consent` cookie (JSON) written by the
 * cookie banner / privacy center. Returns true when analytics consent
 * is explicitly denied. Absent/unparseable cookie = not denied (the
 * visitor id still stays consent-gated separately).
 */
export function analyticsDeniedByConsent(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(/(?:^|;\s*)astralium-consent=([^;]+)/);
  if (!match) return false;
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as { analytics?: unknown };
    return parsed.analytics === false;
  } catch {
    return false;
  }
}

export function isAnalyticsType(v: unknown): v is AnalyticsEventType {
  return typeof v === "string" && (ANALYTICS_TYPES as readonly string[]).includes(v);
}

// ─── Store ───────────────────────────────────────────────────────────────────

async function readFileEvents(): Promise<AnalyticsEventRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as AnalyticsEventRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeFileEvents(list: AnalyticsEventRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list.slice(-FILE_CAP), null, 2), "utf8");
}

export async function recordAnalyticsEvent(input: {
  type: AnalyticsEventType;
  productId?: string | null;
  path?: string | null;
  country?: string | null;
  visitorHash?: string | null;
  at?: Date;
}): Promise<AnalyticsEventRecord> {
  const at = input.at ?? new Date();
  const record: AnalyticsEventRecord = {
    id: randomUUID(),
    type: input.type,
    productId: input.productId ? input.productId.slice(0, 80) : null,
    path: input.path ? input.path.slice(0, 300) : null,
    country: input.country ?? null,
    visitorHash: input.visitorHash ?? null,
    day: utcDay(at),
    createdAt: at.toISOString(),
  };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.analyticsEvent.create({
        data: {
          type: record.type, productId: record.productId, path: record.path,
          country: record.country, visitorHash: record.visitorHash, day: record.day,
        },
      });
      return record;
    } catch { /* fall through to file */ }
  }
  const all = await readFileEvents();
  all.push(record);
  await writeFileEvents(all);
  return record;
}

export async function listAnalyticsEvents(opts: { sinceDay?: string; limit?: number } = {}): Promise<AnalyticsEventRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.analyticsEvent.findMany({
        where: opts.sinceDay ? { day: { gte: opts.sinceDay } } : undefined,
        orderBy: { createdAt: "asc" },
        take: opts.limit ?? 100_000,
      });
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id, type: r.type as AnalyticsEventType, productId: r.productId, path: r.path,
          country: r.country, visitorHash: r.visitorHash, day: r.day, createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch { /* fall through */ }
  }
  const all = await readFileEvents();
  return opts.sinceDay ? all.filter((e) => e.day >= opts.sinceDay!) : all;
}

/** Retention prune: remove events whose day is older than `retentionDays`. */
export async function pruneAnalyticsEvents(retentionDays: number, now = new Date()): Promise<number> {
  const cutoffDay = utcDay(new Date(now.getTime() - retentionDays * 24 * 3600 * 1000));
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const res = await db.analyticsEvent.deleteMany({ where: { day: { lt: cutoffDay } } });
      return res.count;
    } catch { /* fall through */ }
  }
  const all = await readFileEvents();
  const kept = all.filter((e) => e.day >= cutoffDay);
  if (kept.length !== all.length) await writeFileEvents(kept);
  return all.length - kept.length;
}

// ─── Aggregations (pure) ─────────────────────────────────────────────────────

export interface DayCounts {
  day: string;
  pageview: number;
  product_view: number;
  add_to_cart: number;
  checkout_start: number;
  purchase: number;
  total: number;
  visitors: number; // distinct visitor hashes that day
}

/** Per-day series for the last `days` UTC days, zero-filled honestly. */
export function dailySeries(events: AnalyticsEventRecord[], days: number, now = new Date()): DayCounts[] {
  const out: DayCounts[] = [];
  const byDay = new Map<string, AnalyticsEventRecord[]>();
  for (const e of events) {
    const list = byDay.get(e.day) ?? [];
    list.push(e);
    byDay.set(e.day, list);
  }
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(now.getTime() - i * 24 * 3600 * 1000));
    const list = byDay.get(day) ?? [];
    const counts: DayCounts = {
      day, pageview: 0, product_view: 0, add_to_cart: 0, checkout_start: 0, purchase: 0,
      total: list.length, visitors: new Set(list.map((e) => e.visitorHash).filter(Boolean)).size,
    };
    for (const e of list) counts[e.type] += 1;
    out.push(counts);
  }
  return out;
}

export interface FunnelStep { type: AnalyticsEventType; count: number; conversionFromPrevious: number | null }

export function funnel(events: AnalyticsEventRecord[]): FunnelStep[] {
  const order: AnalyticsEventType[] = ["pageview", "product_view", "add_to_cart", "checkout_start", "purchase"];
  const counts = new Map<AnalyticsEventType, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  let prev: number | null = null;
  return order.map((type) => {
    const count = counts.get(type) ?? 0;
    const conversion = prev == null || prev === 0 ? null : Math.round((count / prev) * 1000) / 10;
    prev = count;
    return { type, count, conversionFromPrevious: conversion };
  });
}

export interface TopProduct { productId: string; views: number; carts: number; purchases: number }

export function topProducts(events: AnalyticsEventRecord[], limit = 10): TopProduct[] {
  const map = new Map<string, TopProduct>();
  for (const e of events) {
    if (!e.productId) continue;
    const row = map.get(e.productId) ?? { productId: e.productId, views: 0, carts: 0, purchases: 0 };
    if (e.type === "product_view") row.views++;
    else if (e.type === "add_to_cart") row.carts++;
    else if (e.type === "purchase") row.purchases++;
    else continue;
    map.set(e.productId, row);
  }
  return [...map.values()]
    .sort((a, b) => b.views - a.views || b.purchases - a.purchases)
    .slice(0, limit);
}

/** CSV export: one row per day, one column per event type. */
export function analyticsCsv(series: DayCounts[]): string {
  const header = "day,pageview,product_view,add_to_cart,checkout_start,purchase,total,visitors";
  const lines = series.map((d) => [d.day, d.pageview, d.product_view, d.add_to_cart, d.checkout_start, d.purchase, d.total, d.visitors].join(","));
  return [header, ...lines].join("\n") + "\n";
}

/**
 * Map a daily series onto SVG polyline points (pure — the dashboard
 * charts are hand-rolled SVG, no chart library). Returns "" for an
 * all-zero series so the UI can render its honest empty state.
 */
export function seriesToPoints(values: number[], width: number, height: number, pad = 4): string {
  const max = Math.max(...values, 0);
  if (values.length === 0 || max === 0) return "";
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => `${(pad + i * stepX).toFixed(1)},${(height - pad - (v / max) * (height - pad * 2)).toFixed(1)}`)
    .join(" ");
}
