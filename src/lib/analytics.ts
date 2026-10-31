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
  // Manager's Office dimensions (Phase 4 upgrade): coarse classes only.
  device: string | null; // mobile | tablet | desktop | bot | null (legacy rows)
  browser: string | null; // Chrome | Safari | Firefox | Edge | Opera | Other | null
  source: string | null; // utm_source | referrer host | "direct" | null
  day: string; // YYYY-MM-DD (UTC)
  createdAt: string;
}

// ─── Dimensions (pure) ───────────────────────────────────────────────────────

export type DeviceClass = "mobile" | "tablet" | "desktop" | "bot";

/**
 * Coarse device/browser classes from a User-Agent string. The raw UA is
 * NEVER stored — only these classes reach the event record. Order
 * matters: bots first, then tablets (several tablet UAs also say
 * "Mobile"), then the browser families (Edge/Opera UAs contain
 * "Chrome", Chrome UAs contain "Safari").
 */
export function parseUserAgent(ua: string | null | undefined): { device: DeviceClass; browser: string } {
  const s = (ua ?? "").slice(0, 400);
  if (!s) return { device: "desktop", browser: "Other" };
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless/i.test(s)) {
    return { device: "bot", browser: "Other" };
  }
  let device: DeviceClass = "desktop";
  if (/ipad|tablet|playbook|silk|kindle|tab(?!let browser)/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) {
    device = "tablet";
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(s)) {
    device = "mobile";
  }
  let browser = "Other";
  if (/edg(a|ios)?\//i.test(s)) browser = "Edge";
  else if (/opr\/|opera/i.test(s)) browser = "Opera";
  else if (/firefox\//i.test(s)) browser = "Firefox";
  else if (/chrome\/|crios\//i.test(s)) browser = "Chrome";
  else if (/safari\//i.test(s)) browser = "Safari";
  return { device, browser };
}

/**
 * Traffic source for one event: an explicit utm_source wins (strictly
 * sanitized), else the referrer's host when it is not our own host,
 * else "direct". Returns null when nothing trustworthy is known.
 */
export function trafficSource(input: { utmSource?: unknown; referrerHost?: unknown; ownHost?: string | null }): string | null {
  if (typeof input.utmSource === "string") {
    const clean = input.utmSource.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
    if (clean) return clean;
  }
  if (typeof input.referrerHost === "string") {
    const host = input.referrerHost.trim().toLowerCase().slice(0, 100);
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && host !== (input.ownHost ?? "")) return host;
  }
  return "direct";
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
  device?: string | null;
  browser?: string | null;
  source?: string | null;
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
    device: input.device ?? null,
    browser: input.browser ?? null,
    source: input.source ?? null,
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
          device: record.device, browser: record.browser, source: record.source,
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
          country: r.country, visitorHash: r.visitorHash,
          device: r.device ?? null, browser: r.browser ?? null, source: r.source ?? null,
          day: r.day, createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch { /* fall through */ }
  }
  const all = await readFileEvents();
  // Legacy file rows predate the dimension fields — normalize them.
  const normalized = all.map((e) => ({ ...e, device: e.device ?? null, browser: e.browser ?? null, source: e.source ?? null }));
  return opts.sinceDay ? normalized.filter((e) => e.day >= opts.sinceDay!) : normalized;
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

// ─── Office overview aggregates (pure, Phase 4 upgrade) ──────────────────────

export interface DimensionCount { key: string; count: number; visitors: number }

/** Ranked counts for one event dimension (country/device/browser/source…). */
export function dimensionCounts(
  events: AnalyticsEventRecord[],
  pick: (e: AnalyticsEventRecord) => string | null,
  limit = 12,
): DimensionCount[] {
  const map = new Map<string, { count: number; visitors: Set<string> }>();
  for (const e of events) {
    const key = pick(e) ?? "unknown";
    const row = map.get(key) ?? { count: 0, visitors: new Set<string>() };
    row.count += 1;
    if (e.visitorHash) row.visitors.add(e.visitorHash);
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, count: v.count, visitors: v.visitors.size }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export interface RangeStats {
  events: number;
  pageviews: number;
  productViews: number;
  purchases: number;
  /** Distinct visitor hashes inside the range. NOTE: the salt rotates
   *  daily, so a person visiting on two days counts once per day — this
   *  is "daily uniques summed", the strongest claim the privacy design
   *  allows. */
  visitors: number;
}

/** Stats for events whose day falls in [fromDay, toDay] (inclusive, UTC days). */
export function rangeStats(events: AnalyticsEventRecord[], fromDay: string, toDay: string): RangeStats {
  const inRange = events.filter((e) => e.day >= fromDay && e.day <= toDay);
  const visitors = new Set<string>();
  const stats: RangeStats = { events: inRange.length, pageviews: 0, productViews: 0, purchases: 0, visitors: 0 };
  for (const e of inRange) {
    if (e.type === "pageview") stats.pageviews += 1;
    else if (e.type === "product_view") stats.productViews += 1;
    else if (e.type === "purchase") stats.purchases += 1;
    if (e.visitorHash) visitors.add(`${e.day}:${e.visitorHash}`);
  }
  stats.visitors = visitors.size;
  return stats;
}

export interface TopPage { path: string; views: number; visitors: number }

/** Most-viewed paths (pageview events only), ranked. */
export function topPages(events: AnalyticsEventRecord[], limit = 10): TopPage[] {
  const map = new Map<string, { views: number; visitors: Set<string> }>();
  for (const e of events) {
    if (e.type !== "pageview" || !e.path) continue;
    const row = map.get(e.path) ?? { views: 0, visitors: new Set<string>() };
    row.views += 1;
    if (e.visitorHash) row.visitors.add(e.visitorHash);
    map.set(e.path, row);
  }
  return [...map.entries()]
    .map(([path, v]) => ({ path, views: v.views, visitors: v.visitors.size }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/**
 * "Visitors now": distinct visitor hashes with any event in the last
 * `windowMinutes`, plus their pageview count. An event-based presence
 * measure (no heartbeat exists) — the office UI labels it as such.
 */
export function activeVisitors(events: AnalyticsEventRecord[], windowMinutes = 5, now = new Date()): { visitors: number; pageviews: number } {
  const cutoff = now.getTime() - windowMinutes * 60 * 1000;
  const visitors = new Set<string>();
  let pageviews = 0;
  for (const e of events) {
    if (new Date(e.createdAt).getTime() < cutoff) continue;
    if (e.visitorHash) visitors.add(e.visitorHash);
    if (e.type === "pageview") pageviews += 1;
  }
  return { visitors: visitors.size, pageviews };
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
