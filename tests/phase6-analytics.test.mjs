import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "astralium-p6-analytics-"));
process.chdir(dir);
delete process.env.DATABASE_URL;
process.env.ANALYTICS_SALT = "test-salt";

const an = await import("../src/lib/analytics.ts");

test("visitor hash: deterministic per day, rotates daily, null without IP", () => {
  const day1 = new Date("2026-10-30T10:00:00Z");
  const day1Late = new Date("2026-10-30T23:59:00Z");
  const day2 = new Date("2026-10-31T00:01:00Z");
  const h1 = an.hashVisitor("203.0.113.77", "Mozilla/5.0", day1);
  assert.equal(h1, an.hashVisitor("203.0.113.77", "Mozilla/5.0", day1Late), "same day → same hash");
  assert.notEqual(h1, an.hashVisitor("203.0.113.77", "Mozilla/5.0", day2), "next day → different hash (rotation)");
  assert.notEqual(h1, an.hashVisitor("203.0.113.78", "Mozilla/5.0", day1), "different IP → different hash");
  assert.equal(an.hashVisitor(null, "Mozilla/5.0", day1), null);
  assert.equal(h1.length, 32);
});

test("stored events never contain the raw IP", async () => {
  const ip = "203.0.113.77";
  const visitorHash = an.hashVisitor(ip, "UA", new Date());
  await an.recordAnalyticsEvent({ type: "pageview", path: "/en", country: "MA", visitorHash });
  const file = path.join(dir, ".data", "analytics-events.json");
  assert.ok(existsSync(file));
  const raw = readFileSync(file, "utf8");
  assert.ok(!raw.includes(ip), "raw IP must never reach the store");
  assert.ok(raw.includes(visitorHash), "only the salted hash is stored");
});

test("country: 2-letter codes only, platform headers, junk rejected", () => {
  const headers = (obj) => (name) => obj[name] ?? null;
  assert.equal(an.countryFromHeaders(headers({ "cf-ipcountry": "ma" })), "MA");
  assert.equal(an.countryFromHeaders(headers({ "x-vercel-ip-country": "FR" })), "FR");
  assert.equal(an.countryFromHeaders(headers({ "cf-ipcountry": "XX" })), null);
  assert.equal(an.countryFromHeaders(headers({ "cf-ipcountry": "T1" })), null);
  assert.equal(an.countryFromHeaders(headers({ "cf-ipcountry": "Morocco" })), null);
  assert.equal(an.countryFromHeaders(headers({})), null);
});

test("consent cookie: explicit analytics denial drops events", () => {
  const cookie = (v) => `other=1; astralium-consent=${encodeURIComponent(JSON.stringify(v))}; x=2`;
  assert.equal(an.analyticsDeniedByConsent(cookie({ analytics: false, marketing: true })), true);
  assert.equal(an.analyticsDeniedByConsent(cookie({ analytics: true, marketing: false })), false);
  assert.equal(an.analyticsDeniedByConsent(null), false);
  assert.equal(an.analyticsDeniedByConsent("session=abc"), false);
  assert.equal(an.analyticsDeniedByConsent("astralium-consent=not-json"), false);
});

test("dailySeries: zero-filled honest empties + per-type counts + distinct visitors", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  const empty = an.dailySeries([], 7, now);
  assert.equal(empty.length, 7);
  assert.ok(empty.every((d) => d.total === 0 && d.pageview === 0 && d.visitors === 0));
  assert.equal(empty[6].day, "2026-10-30");
  assert.equal(empty[0].day, "2026-10-24");
  const ev = (type, day, vh) => ({
    id: Math.random().toString(36), type, productId: null, path: null, country: null,
    visitorHash: vh, day, createdAt: `${day}T10:00:00.000Z`,
  });
  const series = an.dailySeries([
    ev("pageview", "2026-10-30", "v1"), ev("pageview", "2026-10-30", "v1"),
    ev("pageview", "2026-10-30", "v2"), ev("purchase", "2026-10-30", "v2"),
    ev("pageview", "2026-10-29", "v9"),
  ], 7, now);
  const today = series[6];
  assert.equal(today.pageview, 3);
  assert.equal(today.purchase, 1);
  assert.equal(today.visitors, 2, "distinct visitor hashes, not event count");
  assert.equal(series[5].pageview, 1);
});

test("funnel: ordered steps with step conversions; zero-safe", () => {
  const ev = (type) => ({
    id: Math.random().toString(36), type, productId: null, path: null, country: null,
    visitorHash: null, day: "2026-10-30", createdAt: "2026-10-30T10:00:00.000Z",
  });
  const events = [
    ...Array.from({ length: 100 }, () => ev("pageview")),
    ...Array.from({ length: 50 }, () => ev("product_view")),
    ...Array.from({ length: 25 }, () => ev("add_to_cart")),
    ...Array.from({ length: 10 }, () => ev("checkout_start")),
    ...Array.from({ length: 5 }, () => ev("purchase")),
  ];
  const f = an.funnel(events);
  assert.deepEqual(f.map((s) => s.count), [100, 50, 25, 10, 5]);
  assert.deepEqual(f.map((s) => s.conversionFromPrevious), [null, 50, 50, 40, 50]);
  const zero = an.funnel([]);
  assert.ok(zero.every((s) => s.count === 0 && (s.conversionFromPrevious === null || s.conversionFromPrevious === 0)));
});

test("topProducts + CSV + SVG points", () => {
  const ev = (type, productId) => ({
    id: Math.random().toString(36), type, productId, path: null, country: null,
    visitorHash: null, day: "2026-10-30", createdAt: "2026-10-30T10:00:00.000Z",
  });
  const events = [
    ev("product_view", "a"), ev("product_view", "a"), ev("product_view", "b"),
    ev("add_to_cart", "a"), ev("purchase", "b"), ev("pageview", null),
  ];
  const top = an.topProducts(events, 10);
  assert.equal(top[0].productId, "a");
  assert.deepEqual([top[0].views, top[0].carts, top[0].purchases], [2, 1, 0]);
  assert.equal(top[1].productId, "b");
  const series = an.dailySeries(events, 1, new Date("2026-10-30T12:00:00Z"));
  const csv = an.analyticsCsv(series);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "day,pageview,product_view,add_to_cart,checkout_start,purchase,total,visitors");
  assert.equal(lines.length, 2);
  assert.equal(an.seriesToPoints([0, 0, 0], 100, 50), "", "all-zero series → no polyline (empty state)");
  const pts = an.seriesToPoints([1, 3, 2], 100, 50).split(" ");
  assert.equal(pts.length, 3);
});

test("retention prune: old days removed, recent kept", async () => {
  const now = new Date();
  const old = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  await an.recordAnalyticsEvent({ type: "pageview", at: old });
  await an.recordAnalyticsEvent({ type: "pageview", at: now });
  const removed = await an.pruneAnalyticsEvents(30, now);
  assert.equal(removed, 1);
  const remaining = await an.listAnalyticsEvents();
  assert.ok(remaining.every((e) => e.day >= an.utcDay(new Date(now.getTime() - 30 * 24 * 3600 * 1000))));
});
