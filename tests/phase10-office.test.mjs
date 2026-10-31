/**
 * Phase 4 upgrade — Manager's Office:
 *  - the role/permission matrix (the brief's hard rule: a support
 *    account must be denied money, bank and security — enforced by
 *    `can()`, which both the office page and requireAdmin consult),
 *  - profit reconciliation over ledger fixtures (sums must balance),
 *  - first-party analytics parsing/aggregation (UA, sources, ranges),
 *  - the bank vault round-trip + tamper refusal (file mode),
 *  - office-managed coupons, scheduling, refund math, ticket rules,
 *    design sanitizers and the country projection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p10-office-")));
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "<MASKED_SECRET_001>";
process.env.ADMIN_PASSWORD = "<MASKED_SECRET_002>";

const team = await import("../src/lib/team.ts");
const finance = await import("../src/lib/office-finance.ts");
const analytics = await import("../src/lib/analytics.ts");
const vault = await import("../src/lib/bank-vault.ts");
const coupons = await import("../src/lib/coupons.ts");
const catalog = await import("../src/lib/catalog.ts");
const orders = await import("../src/lib/orders.ts");
const tickets = await import("../src/lib/tickets.ts");
const design = await import("../src/lib/design.ts");
const geo = await import("../src/lib/countries-geo.ts");

// ─── 1. Role matrix (brief item 9) ───────────────────────────────────────────

test("roles: support is denied finance, bank, security and team", () => {
  for (const perm of ["finance", "bank", "security", "team"]) {
    assert.equal(team.can("support", perm), false, `support must NOT have ${perm}`);
  }
  assert.equal(team.can("support", "read"), true);
  assert.equal(team.can("support", "support_ops"), true);
});

test("roles: only the owner holds bank + security; accountant alone shares finance", () => {
  assert.equal(team.can("owner", "bank"), true);
  assert.equal(team.can("owner", "security"), true);
  assert.equal(team.can("owner", "finance"), true);
  for (const role of ["admin", "manager", "marketer", "accountant", "viewer"]) {
    assert.equal(team.can(role, "bank"), false, `${role} must NOT have bank`);
    assert.equal(team.can(role, "security"), false, `${role} must NOT have security`);
  }
  assert.equal(team.can("accountant", "finance"), true);
  assert.equal(team.can("accountant", "content"), false);
  for (const role of ["admin", "manager", "support", "marketer", "viewer"]) {
    assert.equal(team.can(role, "finance"), false, `${role} must NOT have finance`);
  }
});

test("roles: marketer has content but no money; manager runs ops but no money/bank/security", () => {
  assert.equal(team.can("marketer", "content"), true);
  assert.equal(team.can("marketer", "finance"), false);
  assert.equal(team.can("manager", "support_ops"), true);
  assert.equal(team.can("manager", "commerce"), true);
  assert.equal(team.can("manager", "audit"), true);
  assert.equal(team.can("manager", "team"), false);
});

// ─── 2. Profit reconciliation (brief item 2) ─────────────────────────────────

const SETTINGS = { stripeFeePercent: 2.9, stripeFeeFixedUSD: 0.3, paypalFeePercent: 3.49, paypalFeeFixedUSD: 0.49, taxPercent: 10 };
function orderFixture(partial) {
  return {
    id: partial.id, email: partial.email ?? "buyer@example.com", status: partial.status,
    totalUSD: partial.totalUSD, refundUSD: partial.refundUSD ?? 0, currency: "USD",
    provider: partial.provider ?? "stripe", providerRef: `cs_${partial.id}`,
    deliveryChannel: "email", deliverySubjectHash: null,
    items: partial.items, country: partial.country ?? null, locale: partial.locale ?? null,
    note: "", createdAt: partial.createdAt ?? "2026-10-15T10:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z",
  };
}
const FIXTURE_ORDERS = [
  orderFixture({ id: "o1", status: "fulfilled", totalUSD: 100, items: [{ productId: "p1", priceUSD: 60 }, { productId: "p2", priceUSD: 40 }], country: "MA", locale: "ar" }),
  orderFixture({ id: "o2", status: "paid", totalUSD: 50, provider: "paypal", items: [{ productId: "p1", priceUSD: 50 }], country: "FR", locale: "fr" }),
  orderFixture({ id: "o3", status: "refunded", totalUSD: 30, refundUSD: 30, items: [{ productId: "p2", priceUSD: 30 }] }),
  orderFixture({ id: "o4", status: "fulfilled", totalUSD: 80, refundUSD: 20, items: [{ productId: "p1", priceUSD: 80 }] }),
  orderFixture({ id: "o5", status: "pending", totalUSD: 999, items: [{ productId: "p1", priceUSD: 999 }] }),
  orderFixture({ id: "o6", status: "failed", totalUSD: 777, items: [{ productId: "p1", priceUSD: 777 }] }),
  orderFixture({ id: "o7", status: "disputed", totalUSD: 25, items: [{ productId: "p2", priceUSD: 25 }] }),
];
const RANGE = { fromISO: "2026-10-01T00:00:00.000Z", toISO: "2026-10-31T23:59:59.000Z" };

test("finance: report reconciles with the ledger fixtures", () => {
  const costs = new Map([["p1", 10], ["p2", 5]]);
  const adSpend = [{ id: "a1", date: "2026-10-10", amountUSD: 40, label: "launch" }];
  const report = finance.salesReport(FIXTURE_ORDERS, { settings: SETTINGS, costByProductId: costs, adSpend, ...RANGE });

  // Revenue orders = paid/fulfilled/refunded/disputed (money that was
  // charged); pending/failed never enter the money figures.
  assert.equal(report.counts.fulfilled, 3);
  assert.equal(report.counts.pending, 1);
  assert.equal(report.counts.cancelled, 1);
  assert.equal(report.counts.refunded, 1);
  assert.equal(report.counts.disputed, 1);
  assert.equal(report.counts.total, 7);
  assert.equal(report.grossUSD, 285); // 100 + 50 + 30 + 80 + 25
  assert.equal(report.refundsUSD, 50); // o3 30 + o4 partial 20
  // fees per revenue order: stripe 100→3.20, paypal 50→2.24, stripe 30→1.17, stripe 80→2.62, stripe 25→1.02
  assert.equal(report.feesUSD, 10.25);
  assert.equal(report.taxesUSD, 28.5); // 10% of gross
  // product costs at current catalog cost over revenue orders: (10+5) + 10 + 5 + 10 + 5 = 45
  assert.equal(report.productCostsUSD, 45);
  assert.equal(report.adSpendUSD, 40);
  assert.equal(report.netProfitUSD, 111.25); // 285 − 50 − 10.25 − 28.5 − 45 − 40
  // The reconciliation identity: item sums + discount gap == gross.
  assert.equal(report.reconciliation.balanced, true);
  assert.equal(report.reconciliation.itemsRevenueUSD, 285);
  assert.equal(report.reconciliation.discountGapUSD, 0);
  // Breakdowns sum back to gross.
  const byProductGross = report.byProduct.reduce((s, r) => s + r.revenueUSD, 0);
  assert.equal(Math.round(byProductGross * 100) / 100, 285);
  const byCountryGross = report.byCountry.reduce((s, r) => s + r.revenueUSD, 0);
  assert.equal(Math.round(byCountryGross * 100) / 100, 285);
});

test("finance: fee estimates follow the provider formulas; non-revenue orders are free", () => {
  const stripeOrder = orderFixture({ id: "f1", status: "paid", totalUSD: 100, items: [] });
  const paypalOrder = orderFixture({ id: "f2", status: "paid", totalUSD: 50, provider: "paypal", items: [] });
  const pendingOrder = orderFixture({ id: "f3", status: "pending", totalUSD: 100, items: [] });
  assert.equal(finance.estimateFeeUSD(stripeOrder, SETTINGS), 3.2);
  assert.equal(finance.estimateFeeUSD(paypalOrder, SETTINGS), 2.24);
  assert.equal(finance.estimateFeeUSD(pendingOrder, SETTINGS), 0);
});

test("finance: previous period is the equal-length window right before", () => {
  const prev = finance.previousRange("2026-10-11T00:00:00.000Z", "2026-10-20T23:59:59.999Z");
  assert.equal(prev.toISO, "2026-10-10T23:59:59.999Z");
  const len = new Date(prev.toISO).getTime() - new Date(prev.fromISO).getTime();
  const cur = new Date("2026-10-20T23:59:59.999Z").getTime() - new Date("2026-10-11T00:00:00.000Z").getTime();
  assert.equal(len, cur);
});

test("finance: customers aggregate per email with fulfilled spend only", () => {
  const customers = finance.aggregateCustomers(FIXTURE_ORDERS);
  const buyer = customers.find((c) => c.email === "buyer@example.com");
  assert.ok(buyer);
  assert.equal(buyer.orders, 7);
  // Net spend over revenue orders: 100 + 50 + (30−30) + (80−20) + 25 = 235.
  assert.equal(buyer.spendUSD, 235);
  assert.equal(buyer.refundedUSD, 50);
});

test("finance: CSV export carries the headline figures", () => {
  const report = finance.salesReport(FIXTURE_ORDERS, { settings: SETTINGS, costByProductId: new Map(), adSpend: [], ...RANGE });
  const csv = finance.salesCsv(report, RANGE);
  assert.match(csv, /summary,2026-10-01\.\.2026-10-31,3,285,50,0,196\.25/);
  assert.match(csv, /product,p1,3,190,20,0,170/);
});

// ─── 3. Analytics (brief item 1) ─────────────────────────────────────────────

test("analytics: user-agent parsing classifies device + browser, bots first", () => {
  const iphone = analytics.parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
  assert.deepEqual(iphone, { device: "mobile", browser: "Safari" });
  const edge = analytics.parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0");
  assert.deepEqual(edge, { device: "desktop", browser: "Edge" });
  const bot = analytics.parseUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
  assert.equal(bot.device, "bot");
  const none = analytics.parseUserAgent(null);
  assert.deepEqual(none, { device: "desktop", browser: "Other" });
});

test("analytics: traffic source prefers sanitized UTM, then referrer host, else direct", () => {
  assert.equal(analytics.trafficSource({ utmSource: "Google Ads!", referrerHost: "x.com", ownHost: "shop.example" }), "googleads");
  assert.equal(analytics.trafficSource({ referrerHost: "news.ycombinator.com", ownHost: "shop.example" }), "news.ycombinator.com");
  assert.equal(analytics.trafficSource({ referrerHost: "shop.example", ownHost: "shop.example" }), "direct");
  assert.equal(analytics.trafficSource({}), "direct");
});

test("analytics: range stats, funnel and active visitors over synthetic events", () => {
  const ev = (type, day, visitorHash, extra = {}) => ({
    id: Math.random().toString(36).slice(2), type, path: extra.path ?? "/", productId: null,
    country: extra.country ?? null, device: extra.device ?? null, browser: extra.browser ?? null,
    source: extra.source ?? null, visitorHash, day, createdAt: `${day}T10:00:00.000Z`,
  });
  const events = [
    ev("pageview", "2026-10-30", "v1", { path: "/en", country: "MA" }),
    ev("pageview", "2026-10-30", "v2", { path: "/en/shop", country: "FR" }),
    ev("product_view", "2026-10-30", "v1"),
    ev("add_to_cart", "2026-10-30", "v1"),
    ev("checkout_start", "2026-10-30", "v1"),
    ev("purchase", "2026-10-30", "v1"),
    ev("pageview", "2026-10-24", "v1", { path: "/en" }),
  ];
  const stats = analytics.rangeStats(events, "2026-10-30", "2026-10-30");
  assert.equal(stats.pageviews, 2);
  assert.equal(stats.visitors, 2);
  const f = analytics.funnel(events);
  assert.deepEqual(f.map((s) => s.count), [3, 1, 1, 1, 1]);
  assert.deepEqual(analytics.topPages(events, 5)[0], { path: "/en", views: 2, visitors: 1 });
  const countries = analytics.dimensionCounts(events, (e) => e.country, 5);
  assert.equal(countries.find((c) => c.key === "MA")?.count, 1);
  const now = new Date("2026-10-30T10:04:00.000Z");
  const fresh = [{ ...ev("pageview", "2026-10-30", "v9"), createdAt: "2026-10-30T10:02:00.000Z" }];
  assert.equal(analytics.activeVisitors(fresh, 5, now).visitors, 1);
  assert.equal(analytics.activeVisitors(events, 5, now).visitors, 2); // both 10:00 events are inside the 10:04 −5min window
});

// ─── 4. Bank vault (brief item 7) ────────────────────────────────────────────

test("bank vault: encrypt → masked read → reveal round-trip; tamper is refused", async () => {
  const details = {
    accountHolder: "Yond Test", bankName: "CIH Bank", accountNumber: "2307801234567890",
    iban: "MA64023078001234567890123456", swiftBic: "CIHMMAMC", currency: "MAD", notes: "main",
  };
  const saved = await vault.writeVault(vault.sanitizeBankDetails(details), "owner@test");
  assert.equal(saved.ok, true);
  const file = path.join(process.cwd(), ".data", "bank-vault.json");
  assert.equal(existsSync(file), true);
  const raw = readFileSync(file, "utf8");
  assert.equal(raw.includes("2307801234567890"), false, "account number must never be stored in plaintext");
  assert.equal(raw.includes("MA64023078001234567890123456"), false, "IBAN must never be stored in plaintext");

  const read = await vault.readVault();
  assert.equal(read.state, "ok");
  assert.equal(read.masked.accountNumber.includes("7890"), true);
  assert.equal(read.masked.accountNumber.includes("23078012"), false);
  assert.deepEqual(read.details, vault.sanitizeBankDetails(details));

  // Tamper with the ciphertext: decryption must refuse, not return garbage.
  const doc = JSON.parse(raw);
  const parts = doc.cipher.split(":");
  parts[3] = parts[3].slice(0, -4) + "AAAA";
  doc.cipher = parts.join(":");
  writeFileSync(file, JSON.stringify(doc));
  const tampered = await vault.readVault();
  assert.equal(tampered.state, "unavailable");
});

test("bank vault: mask keeps only the last 4 characters of secrets", () => {
  const masked = vault.maskBankDetails({
    accountHolder: "Yond Test", bankName: "CIH Bank", accountNumber: "2307801234567890",
    iban: "MA64023078001234567890123456", swiftBic: "CIHMMAMC", currency: "MAD", notes: "main",
  });
  assert.equal(masked.accountNumber, "•••• •••• 7890");
  assert.equal(masked.iban, "•••• •••• 3456");
  assert.equal(masked.notes, "••••••••");
  assert.equal(masked.bankName, "CIH Bank"); // non-secret fields stay readable
});

// ─── 5. Coupons, scheduling, refunds, tickets, design, geo ───────────────────

test("coupons: sanitizer bounds values; the managed list drives the engine", () => {
  assert.equal(coupons.sanitizeCoupon({ code: "x", type: "percent", value: 150 }), null);
  assert.equal(coupons.sanitizeCoupon({ code: "ok10", type: "percent", value: 10 })?.code, "OK10");
  const list = [coupons.sanitizeCoupon({ code: "VIP", type: "fixed", value: 5, minSubtotalUSD: 20 })];
  const hit = coupons.applyCouponIn(list, "vip", 30, { email: "a@b.co", country: "MA", isFirstOrder: false });
  assert.equal(hit.ok, true);
  assert.equal(hit.discountUSD, 5);
  const miss = coupons.applyCouponIn(list, "vip", 10, { email: "a@b.co", country: "MA", isFirstOrder: false });
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, "below-minimum");
});

test("catalog: scheduled products hide until publishAt; locale overlay applies translations", () => {
  const base = { publishAt: null };
  assert.equal(catalog.isScheduledHidden({ ...base, publishAt: "2999-01-01T00:00:00.000Z" }), true);
  assert.equal(catalog.isScheduledHidden({ ...base, publishAt: "2000-01-01T00:00:00.000Z" }), false);
  assert.equal(catalog.isScheduledHidden(base), false);
  const p = { title: "EN title", subtitle: "EN sub", description: "EN desc", translations: { ar: { title: "عنوان" } } };
  const overlaid = catalog.applyLocaleOverlay(p, "ar");
  assert.equal(overlaid.title, "عنوان");
  assert.equal(overlaid.subtitle, "EN sub");
});

test("orders: refund math clamps to the remaining balance and detects full coverage", () => {
  const o = { totalUSD: 100, refundUSD: 30, status: "fulfilled" };
  assert.deepEqual(orders.refundStateAfter(o, 20), { refundUSD: 50, full: false, amount: 20 });
  assert.deepEqual(orders.refundStateAfter(o, 70), { refundUSD: 100, full: true, amount: 70 });
  // Over-asking clamps to the remaining balance (never refunds more than was paid).
  assert.deepEqual(orders.refundStateAfter(o, 71), { refundUSD: 100, full: true, amount: 70 });
  assert.ok("error" in orders.refundStateAfter(o, 0));
  assert.ok("error" in orders.refundStateAfter({ ...o, status: "pending" }, 10));
});

test("tickets: transitions + intake sanitization", () => {
  assert.equal(tickets.canTicketTransition("open", "answered"), true);
  assert.equal(tickets.canTicketTransition("open", "closed"), true);
  assert.equal(tickets.canTicketTransition("closed", "open"), true);
  assert.equal(tickets.canTicketTransition("closed", "answered"), false);
  assert.equal(tickets.canTicketTransition("open", "open"), false);
  assert.equal(tickets.sanitizeTicketInput({ email: "bad", subject: "Hi", message: "hello there" }), null);
  assert.ok(tickets.sanitizeTicketInput({ email: "a@b.co", subject: "Help", message: "I need help" }));
});

test("design: banner sanitizer rejects dangerous URLs; text resolves per locale", () => {
  const bad = design.sanitizeBanner({ enabled: true, textEn: "Sale", url: "javascript:alert(1)" });
  assert.equal(bad.url, "");
  const good = design.sanitizeBanner({ enabled: true, textEn: "Sale", textAr: "تخفيض", url: "/en/shop" });
  assert.equal(design.bannerTextFor(good, "ar"), "تخفيض");
  assert.equal(design.bannerTextFor(good, "fr"), "Sale");
  assert.equal(design.bannerTextFor({ ...good, enabled: false }, "en"), "");
  const hero = design.heroTextFor(design.sanitizeHeroText({ titleAr: "عنوان جديد" }), "ar", { hero_title: "Default", hero_sub: "Sub" });
  assert.equal(hero.title, "عنوان جديد");
  assert.equal(hero.sub, "Sub");
});

test("geo: equirectangular projection corners + country names", () => {
  assert.deepEqual(geo.projectToSvg(90, 0, 1000, 500), { x: 500, y: 0 });
  assert.deepEqual(geo.projectToSvg(0, -180, 1000, 500), { x: 0, y: 250 });
  assert.equal(geo.countryName("MA"), "Morocco");
  assert.equal(geo.countryName("XX"), "XX");
});
