import { test, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const pwyw = await import("../src/lib/pwyw.ts");
const pre = await import("../src/lib/preorders.ts");
const { getProductById } = await import("../src/data/products.ts");
const { getFlag } = await import("../src/lib/flags.ts");

const p10 = getProductById("p10"); // Piano Dreams $9
const CONFIG = {
  p10: {
    minUSD: 5, suggestedUSD: 9,
    tiers: [
      { priceUSD: 9, label: "Standard", bonus: "" },
      { priceUSD: 15, label: "Supporter", bonus: "Sheet music annotated edition" },
    ],
  },
};

after(async () => {
  await pwyw.setPwywConfig({});
  await pre.setPreorderConfig({});
});

test("pwyw sanitize: unknown products dropped; tiers below the floor dropped", () => {
  const clean = pwyw.sanitizePwywConfig({
    p10: { minUSD: 5, suggestedUSD: 3, tiers: [{ priceUSD: 2, label: "Cheap", bonus: "" }, { priceUSD: 9, label: "Std", bonus: "" }] },
    nope: { minUSD: 1, suggestedUSD: 1, tiers: [] },
  });
  assert.deepEqual(Object.keys(clean), ["p10"]);
  assert.equal(clean.p10.suggestedUSD, 5); // suggested never below min
  assert.equal(clean.p10.tiers.length, 1);
  assert.equal(clean.p10.tiers[0].priceUSD, 9);
});

test("pwyw resolution: below-min custom amount rejected server-side", () => {
  const below = pwyw.resolvePwywPrice(CONFIG, p10, { amountUSD: 4.99 });
  assert.deepEqual(below, { ok: false, error: "BELOW_MIN" });
  const atMin = pwyw.resolvePwywPrice(CONFIG, p10, { amountUSD: 5 });
  assert.equal(atMin.ok, true);
  assert.equal(atMin.priceUSD, 5);
  const generous = pwyw.resolvePwywPrice(CONFIG, p10, { amountUSD: 42.5 });
  assert.equal(generous.priceUSD, 42.5);
});

test("pwyw resolution: tier price comes from config, never the request", () => {
  const tier = pwyw.resolvePwywPrice(CONFIG, p10, { tierIndex: 1, amountUSD: 0.01 });
  assert.equal(tier.ok, true);
  assert.equal(tier.priceUSD, 15); // config price — the 0.01 in the request is ignored
  assert.equal(tier.tier.bonus, "Sheet music annotated edition");
  assert.deepEqual(pwyw.resolvePwywPrice(CONFIG, p10, { tierIndex: 9 }), { ok: false, error: "INVALID_TIER" });
  assert.deepEqual(pwyw.resolvePwywPrice(CONFIG, p10, {}), { ok: false, error: "INVALID_AMOUNT" });
  assert.deepEqual(
    pwyw.resolvePwywPrice(CONFIG, getProductById("p01"), { amountUSD: 10 }),
    { ok: false, error: "PWYW_NOT_CONFIGURED" },
  );
});

test("pwyw config persists via the .data fallback and reads back sanitized", async () => {
  const saved = await pwyw.setPwywConfig(CONFIG);
  assert.equal(saved.persisted, "file");
  const read = await pwyw.getPwywConfig();
  assert.equal(read.p10.minUSD, 5);
  assert.equal(read.p10.tiers.length, 2);
});

test("preorders: release gate before/after the release instant", () => {
  const config = { p12: { releaseDate: "2026-12-01T00:00:00.000Z" } };
  assert.equal(pre.isReleased(config, "p12", new Date("2026-11-30T23:59:59.000Z")), false);
  assert.equal(pre.isReleased(config, "p12", new Date("2026-12-01T00:00:00.000Z")), true);
  assert.equal(pre.isReleased(config, "p12", new Date("2027-01-01T00:00:00.000Z")), true);
  // Not a pre-order → always released (downloads flow normally).
  assert.equal(pre.isReleased(config, "p01", new Date("2026-01-01T00:00:00.000Z")), true);
  assert.equal(pre.releaseDateFor(config, "p01"), null);
});

test("preorders: download gate blocks pre-release via stored config", async () => {
  await pre.setPreorderConfig({ p12: { releaseDate: "2999-01-01T00:00:00.000Z" } });
  const blocked = await pre.downloadGate("p12", new Date());
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.releaseDate, "2999-01-01T00:00:00.000Z");
  const open = await pre.downloadGate("p01", new Date());
  assert.equal(open.allowed, true);
});

test("preorders: release job selection — paid only, released only, unnotified only", () => {
  const config = {
    p12: { releaseDate: "2026-10-01T00:00:00.000Z" },
    p11: { releaseDate: "2027-01-01T00:00:00.000Z" },
  };
  const orders = [
    { orderId: "O1", email: "a@x.com", status: "paid", productIds: ["p12", "p11"] }, // p12 due, p11 not yet
    { orderId: "O2", email: "b@x.com", status: "pending", productIds: ["p12"] }, // unpaid → excluded
    { orderId: "O3", email: "c@x.com", status: "fulfilled", productIds: ["p12"] }, // notified → excluded
    { orderId: "O4", email: "d@x.com", status: "paid", productIds: ["p01"] }, // not a pre-order
  ];
  const due = pre.releasesDue(orders, config, new Set(["O3:p12"]), new Date("2026-10-30T00:00:00.000Z"));
  assert.deepEqual(due.map((d) => d.marker), ["O1:p12"]);
});

test("pwyw + preorders flags default OFF (money features)", async () => {
  assert.equal(await getFlag("pwyw"), false);
  assert.equal(await getFlag("preorders"), false);
});
