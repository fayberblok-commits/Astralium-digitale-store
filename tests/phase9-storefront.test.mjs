/**
 * Phase 3 upgrade — homepage layout settings + catalog view helpers:
 * sanitizer round-trips, default order (the brief's), visibility
 * filtering, discount math, curated collections and sorting. The
 * helpers under test are the exact modules the storefront imports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const home = await import("../src/lib/home-settings.ts");
const view = await import("../src/lib/catalog-view.ts");

const { HOME_SECTION_IDS, DEFAULT_HOME_SECTIONS, sanitizeHomeSections, visibleHomeSections } = home;
const { discountPercent, applyCollection, sortProducts } = view;

test("home sections: default order is the Phase-3 brief's order", () => {
  assert.deepEqual(DEFAULT_HOME_SECTIONS.order, [
    "hero", "trust", "featured", "categories", "bundles", "new",
    "how", "guarantee", "testimonials", "faq", "newsletter",
  ]);
  assert.deepEqual(DEFAULT_HOME_SECTIONS.hidden, []);
  assert.equal(HOME_SECTION_IDS.length, 11);
});

test("home sections: sanitizer drops unknown ids, dedupes, heals missing ids", () => {
  const s = sanitizeHomeSections({ order: ["faq", "hero", "faq", "nope", 42], hidden: ["faq", "bogus"] });
  assert.equal(s.order[0], "faq");
  assert.equal(s.order[1], "hero");
  assert.equal(s.order.length, 11);
  assert.equal(new Set(s.order).size, 11);
  assert.deepEqual(s.hidden, ["faq"]);
  // Missing sections are appended in default relative order.
  const tail = s.order.slice(2);
  assert.deepEqual(tail, HOME_SECTION_IDS.filter((id) => id !== "faq" && id !== "hero"));
});

test("home sections: garbage input falls back to the full default layout", () => {
  for (const bad of [null, undefined, "x", 7, [], { order: "hero" }]) {
    const s = sanitizeHomeSections(bad);
    assert.equal(s.order.length, 11);
    assert.deepEqual(s.hidden, []);
  }
});

test("home sections: visible list respects order + hidden", () => {
  const s = sanitizeHomeSections({ order: ["newsletter", "hero", "trust"], hidden: ["trust"] });
  const visible = visibleHomeSections(s);
  assert.equal(visible[0], "newsletter");
  assert.equal(visible[1], "hero");
  assert.ok(!visible.includes("trust"));
  assert.equal(visible.length, 10);
});

test("discount percent: whole-percent math, no fake discounts", () => {
  assert.equal(discountPercent({ priceUSD: 19, compareAtUSD: 49 }), 61);
  assert.equal(discountPercent({ priceUSD: 25, compareAtUSD: 50 }), 50);
  assert.equal(discountPercent({ priceUSD: 50, compareAtUSD: 50 }), 0);
  assert.equal(discountPercent({ priceUSD: 60, compareAtUSD: 50 }), 0);
  assert.equal(discountPercent({ priceUSD: 10 }), 0);
  assert.equal(discountPercent({ priceUSD: 10, compareAtUSD: undefined }), 0);
});

const mk = (id, over = {}) => ({
  id, slug: id, title: id, subtitle: "", description: "", category: "ebooks",
  formats: [{ format: "PDF", sizeMB: 1 }], priceUSD: 30, rating: 4.5,
  reviewsCount: 10, includes: [], preview: "", hue: 10,
  publishedAt: "2026-01-01", ...over,
});

test("collections: bestsellers / under25 / toprated / new filters", () => {
  const now = new Date("2026-10-31T00:00:00Z");
  const items = [
    mk("a", { badge: "bestseller", priceUSD: 19, rating: 4.9 }),
    mk("b", { priceUSD: 24.5, rating: 4.2, publishedAt: "2026-10-01" }),
    mk("c", { priceUSD: 80, rating: 4.85, publishedAt: "2024-01-01" }),
    mk("d", { priceUSD: 40, rating: 4.0, publishedAt: "2024-06-01", badge: "new" }),
  ];
  assert.deepEqual(applyCollection(items, "bestsellers", now).map((p) => p.id), ["a"]);
  assert.deepEqual(applyCollection(items, "under25", now).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(applyCollection(items, "toprated", now).map((p) => p.id), ["a", "c"]);
  // "new" = badge OR published within 120 days of `now`.
  assert.deepEqual(applyCollection(items, "new", now).map((p) => p.id), ["b", "d"]);
  assert.equal(applyCollection(items, "all", now).length, 4);
});

test("sorting: price, rating, newest, popularity, featured", () => {
  const items = [
    mk("a", { priceUSD: 30, rating: 4.5, reviewsCount: 100, publishedAt: "2025-01-01" }),
    mk("b", { priceUSD: 10, rating: 4.9, reviewsCount: 5, publishedAt: "2026-06-01", badge: "bestseller" }),
    mk("c", { priceUSD: 20, rating: 4.9, reviewsCount: 50, publishedAt: "2026-01-01" }),
  ];
  assert.deepEqual(sortProducts(items, "price-asc").map((p) => p.id), ["b", "c", "a"]);
  assert.deepEqual(sortProducts(items, "price-desc").map((p) => p.id), ["a", "c", "b"]);
  assert.deepEqual(sortProducts(items, "rating").map((p) => p.id), ["c", "b", "a"]); // rating tie → reviews
  assert.deepEqual(sortProducts(items, "newest").map((p) => p.id), ["b", "c", "a"]);
  assert.deepEqual(sortProducts(items, "popularity").map((p) => p.id), ["a", "c", "b"]);
  assert.deepEqual(sortProducts(items, "featured").map((p) => p.id), ["b", "a", "c"]); // bestseller first
  // Input array is never mutated.
  assert.deepEqual(items.map((p) => p.id), ["a", "b", "c"]);
});
