import { test, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const { byoDiscount, computeBundlePrice, BYO_MIN_ITEMS, BYO_RATE } = await import("../src/lib/byo.ts");
const { PRODUCTS, getProductById } = await import("../src/data/products.ts");
const bundles = await import("../src/lib/bundles.ts");
const { resolveBumps, discountedPrice, buildUpsellCheckoutParams } = await import("../src/lib/offers.ts");
const { getFlag } = await import("../src/lib/flags.ts");

let createdBundleId = null;
after(async () => {
  if (createdBundleId) await bundles.deleteStoredBundle(createdBundleId);
});

test("BYO bundle: 2 products no discount, 3 products exactly 15%, duplicates counted once", () => {
  const two = byoDiscount(["p01", "p02"], PRODUCTS);
  assert.equal(two.eligible, false);
  assert.equal(two.discountUSD, 0);
  const three = byoDiscount(["p01", "p02", "p03"], PRODUCTS);
  const expected = Math.round((19 + 79 + 12) * BYO_RATE * 100) / 100;
  assert.equal(three.distinctProducts, BYO_MIN_ITEMS);
  assert.equal(three.eligible, true);
  assert.equal(three.discountUSD, expected);
  const dupes = byoDiscount(["p01", "p01", "p02", "p03"], PRODUCTS);
  assert.equal(dupes.distinctProducts, 3);
  assert.equal(dupes.discountUSD, expected);
  const withBundleLine = byoDiscount(["p01", "p02", "b1"], PRODUCTS);
  assert.equal(withBundleLine.eligible, false); // bundle ids are not products
});

test("admin bundle price computation derives from catalog prices", () => {
  const r = computeBundlePrice(["p01", "p02"], 20, PRODUCTS);
  assert.equal(r.sumUSD, 98);
  assert.equal(r.priceUSD, 78.4);
  assert.equal(r.savingsUSD, 19.6);
  const clamped = computeBundlePrice(["p01"], 500, PRODUCTS);
  assert.ok(clamped.priceUSD >= 19 * 0.1 - 0.01); // percent clamped to 90
});

test("stored bundles persist via the .data fallback and drive the storefront", async () => {
  const saved = await bundles.saveStoredBundle({
    title: "Test Trio", description: "phase3 test", productIds: ["p01", "p02", "p03"], discountPercent: 25, active: true,
  });
  assert.equal(saved.persisted, "file");
  createdBundleId = saved.bundle.id;
  const { bundles: list } = await bundles.listStoredBundles();
  const mine = list.find((b) => b.id === createdBundleId);
  assert.ok(mine);
  const expectedPrice = Math.round(110 * 0.75 * 100) / 100;
  assert.equal(bundles.toStorefrontBundle(mine).priceUSD, expectedPrice);
  const storefront = await bundles.storefrontBundles();
  assert.ok(storefront.some((b) => b.id === createdBundleId));
  const resolved = await bundles.resolveBundle(createdBundleId);
  assert.equal(resolved.priceUSD, expectedPrice);
});

test("order bump math: server config decides price; unconfigured/duplicate requests rejected", () => {
  const config = { p01: { bump: { productId: "p02", discountPercent: 25 } } };
  const lines = resolveBumps(["p01"], ["p02"], config);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].priceUSD, Math.round(79 * 0.75 * 100) / 100);
  assert.equal(lines[0].fullPriceUSD, 79);
  // Not configured for this cart → nothing, even if the client asks.
  assert.deepEqual(resolveBumps(["p01"], ["p03"], config), []);
  // Already in the cart → never double-sold.
  assert.deepEqual(resolveBumps(["p01", "p02"], ["p02"], config), []);
  // No config at all → nothing.
  assert.deepEqual(resolveBumps(["p01"], ["p02"], {}), []);
  assert.equal(discountedPrice(getProductById("p02"), 25), 59.25);
});

test("upsell session params: discounted unit amount, new-session markers, original order referenced", () => {
  const params = buildUpsellCheckoutParams({
    orderId: "AST-1", email: "buyer@example.com", product: getProductById("p02"),
    discountPercent: 25, base: "https://example.test", locale: "en",
  });
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), String(Math.round(79 * 0.75 * 100)));
  assert.equal(params.get("metadata[upsell_of]"), "AST-1");
  assert.equal(params.get("client_reference_id"), "AST-1-UPSELL");
  assert.equal(params.get("success_url"), "https://example.test/en/success?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(params.get("mode"), "payment");
});

test("order_bump + wishlist_alerts flags default OFF (money/email gates)", async () => {
  assert.equal(await getFlag("order_bump"), false);
  assert.equal(await getFlag("wishlist_alerts"), false);
  assert.equal(await getFlag("bundles"), true);
  assert.equal(await getFlag("library"), true);
});
