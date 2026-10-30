import { test, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const flash = await import("../src/lib/flash-sales.ts");
const { getProductById } = await import("../src/data/products.ts");
const { getFlag } = await import("../src/lib/flags.ts");

const NOW = new Date("2026-10-30T12:00:00.000Z");
function sale(overrides = {}) {
  return {
    id: "test-sale", name: "Test", productIds: ["p01"], discountPercent: 25,
    startsAt: "2026-10-30T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z",
    quantityCap: null, soldCount: 0, countedOrderIds: [], active: true,
    createdAt: "2026-10-29T00:00:00.000Z", ...overrides,
  };
}

test("campaign state machine: scheduled → active → ended transitions", () => {
  assert.equal(flash.campaignState(sale(), new Date("2026-10-29T23:59:59.000Z")), "scheduled");
  assert.equal(flash.campaignState(sale(), new Date("2026-10-30T00:00:00.000Z")), "active");
  assert.equal(flash.campaignState(sale(), NOW), "active");
  assert.equal(flash.campaignState(sale(), new Date("2026-10-31T00:00:00.000Z")), "ended");
  assert.equal(flash.campaignState(sale(), new Date("2026-11-05T00:00:00.000Z")), "ended");
});

test("campaign state machine: inactive overrides window; sold-out only inside window", () => {
  assert.equal(flash.campaignState(sale({ active: false }), NOW), "inactive");
  assert.equal(flash.campaignState(sale({ quantityCap: 3, soldCount: 3 }), NOW), "sold-out");
  assert.equal(flash.campaignState(sale({ quantityCap: 3, soldCount: 2 }), NOW), "active");
  // Cap reached but campaign not started yet → still scheduled, not sold-out.
  assert.equal(
    flash.campaignState(sale({ quantityCap: 3, soldCount: 3 }), new Date("2026-10-29T00:00:00.000Z")),
    "scheduled",
  );
});

test("flash prices: server-side math; expired/scheduled/sold-out campaigns never discount", () => {
  const p01 = getProductById("p01"); // $19
  const active = flash.resolveFlashPrices([sale()], ["p01"], getProductById, NOW);
  assert.equal(active.get("p01").priceUSD, 14.25); // 19 × 0.75
  assert.equal(active.get("p01").fullPriceUSD, 19);

  const expired = flash.resolveFlashPrices(
    [sale({ endsAt: "2026-10-30T11:00:00.000Z" })], ["p01"], getProductById, NOW,
  );
  assert.equal(expired.size, 0); // expired campaign → no discount entry at all

  const scheduled = flash.resolveFlashPrices(
    [sale({ startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-02T00:00:00.000Z" })], ["p01"], getProductById, NOW,
  );
  assert.equal(scheduled.size, 0);

  const soldOut = flash.resolveFlashPrices(
    [sale({ quantityCap: 1, soldCount: 1 })], ["p01"], getProductById, NOW,
  );
  assert.equal(soldOut.size, 0); // cap exhausted → full price

  assert.equal(flash.flashUnitPrice(sale({ discountPercent: 500 }), p01), 1.9); // clamped to 90% off
});

test("overlapping campaigns: deepest discount wins", () => {
  const prices = flash.resolveFlashPrices(
    [sale({ id: "a", discountPercent: 10 }), sale({ id: "b", discountPercent: 40 })],
    ["p01"], getProductById, NOW,
  );
  assert.equal(prices.get("p01").saleId, "b");
  assert.equal(prices.get("p01").priceUSD, 11.4);
});

test("sanitize: inverted window or unknown products rejected; cap floored at 1", () => {
  assert.equal(flash.sanitizeFlashSaleInput({
    name: "x", productIds: ["p01"], discountPercent: 20,
    startsAt: "2026-10-31T00:00:00.000Z", endsAt: "2026-10-30T00:00:00.000Z",
  }), null);
  assert.equal(flash.sanitizeFlashSaleInput({
    name: "x", productIds: ["nope"], discountPercent: 20,
    startsAt: "2026-10-30T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z",
  }), null);
  const ok = flash.sanitizeFlashSaleInput({
    name: "x", productIds: ["p01", "p01", "nope"], discountPercent: 20, quantityCap: 0,
    startsAt: "2026-10-30T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z",
  });
  assert.deepEqual(ok.productIds, ["p01"]);
  assert.equal(ok.quantityCap, 1);
});

let savedSaleId = null;
after(async () => {
  if (savedSaleId) await flash.deleteFlashSale(savedSaleId);
});

test("cap counting is idempotent per order (retried checkout counts once)", async () => {
  const saved = await flash.saveFlashSale({
    name: "Cap test", productIds: ["p02"], discountPercent: 10, quantityCap: 5,
    startsAt: "2026-10-30T00:00:00.000Z", endsAt: "2026-12-31T00:00:00.000Z",
  });
  assert.equal(saved.ok, true);
  savedSaleId = saved.sale.id;
  assert.equal(await flash.countFlashSaleOrder(savedSaleId, "AST-COUNT-1", 2), 2);
  assert.equal(await flash.countFlashSaleOrder(savedSaleId, "AST-COUNT-1", 2), 2); // replay
  assert.equal(await flash.countFlashSaleOrder(savedSaleId, "AST-COUNT-2", 3), 5);
  const list = await flash.listFlashSales();
  const mine = list.find((s) => s.id === savedSaleId);
  assert.equal(mine.soldCount, 5);
  assert.equal(flash.campaignState(mine, new Date()), "sold-out"); // cap reached → enforcement state
});

test("flash_sales flag defaults OFF (money feature)", async () => {
  assert.equal(await getFlag("flash_sales"), false);
});
