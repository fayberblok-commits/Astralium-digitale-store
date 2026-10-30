import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const { scoreRecommendations, coPurchaseCounts, basketsFromOrders } = await import("../src/lib/recommendations.ts");
const { searchProducts, suggestProducts } = await import("../src/lib/search.ts");
const { PRODUCTS } = await import("../src/data/products.ts");

test("co-purchase scoring: most-bought-together ranks first with also_bought reason", () => {
  const baskets = [
    ["p01", "p02"], ["p01", "p02"], ["p01", "p02", "p03"], ["p04", "p05"],
  ];
  const counts = coPurchaseCounts(baskets, "p01");
  assert.equal(counts.get("p02"), 3);
  assert.equal(counts.get("p03"), 1);
  const recs = scoreRecommendations({ baskets, targetId: "p01" });
  assert.equal(recs[0].productId, "p02");
  assert.equal(recs[0].reason, "also_bought");
  assert.equal(recs[0].coCount, 3);
  const p03 = recs.find((r) => r.productId === "p03");
  assert.ok(p03 && p03.reason === "also_bought");
  assert.ok(!recs.some((r) => r.productId === "p01")); // never recommend the target itself
});

test("fallback with no order data: affinity + top-rated reasons only, target category leads", () => {
  const recs = scoreRecommendations({ baskets: [], targetId: "p01" });
  assert.ok(recs.length > 0);
  assert.ok(recs.every((r) => r.reason === "similar_category" || r.reason === "top_rated"));
  // p01 is an ebook; other ebooks are category-affinity and must outrank fill.
  const ebook = recs.find((r) => r.productId === "p09"); // Digital Marketing Playbook (ebook)
  assert.equal(ebook.reason, "similar_category");
});

test("viewed history (slugs) drives similar_category without any identity data", () => {
  const recs = scoreRecommendations({ baskets: [], viewedIds: ["midnight-lofi-collection"] });
  const piano = recs.find((r) => r.productId === "p10"); // also music
  assert.ok(piano);
  assert.equal(piano.reason, "similar_category");
});

test("aggregator input carries ids only — basketsFromOrders strips everything else", () => {
  const orders = [
    { items: [{ productId: "p01" }, { productId: "p02" }] },
    { items: [{ productId: "p01" }, { productId: "p03" }] },
  ];
  const baskets = basketsFromOrders(orders);
  assert.deepEqual(baskets, [["p01", "p02"], ["p01", "p03"]]);
  assert.ok(!JSON.stringify(baskets).includes("@"));
});

test("smart search tolerates typos: 'blueprnt' finds The AI Profit Blueprint first", () => {
  const hits = searchProducts("blueprnt");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].product.id, "p01");
  const exact = searchProducts("blueprint");
  assert.equal(exact[0].product.id, "p01");
});

test("search ranking: title matches outrank description-only matches", () => {
  const hits = searchProducts("python");
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].product.id, "p12"); // "Data Analysis with Python" — title hit
});

test("search filters are wired to data: language, category, rating", () => {
  const fr = searchProducts("", { filters: { language: "fr" } });
  assert.deepEqual(fr.map((h) => h.product.id), ["p08"]);
  const ebooks = searchProducts("", { filters: { category: "ebooks" } });
  assert.ok(ebooks.length >= 2 && ebooks.every((h) => h.product.category === "ebooks"));
  const top = searchProducts("", { filters: { minRating: 4.9 } });
  assert.ok(top.every((h) => h.product.rating >= 4.9));
  const cheap = searchProducts("", { filters: { maxPriceUSD: 20 } });
  assert.ok(cheap.length >= 1 && cheap.every((h) => h.product.priceUSD <= 20));
  assert.equal(PRODUCTS.length, 12);
});

test("suggestions return title-led matches for the dropdown", () => {
  const sug = suggestProducts("bluepr");
  assert.ok(sug.some((p) => p.id === "p01"));
  assert.deepEqual(suggestProducts("zzzzzz"), []);
});
