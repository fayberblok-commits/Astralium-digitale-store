/**
 * Register item 82 regression suite — the "fake books" leak.
 *
 * On 2026-11-07 the shop's "Recommended for you" rail rendered the
 * deactivated demo products (seed list) with invented ratings/reviews
 * and fake discount prices, because the recommendations engine, the
 * rail, search, share links and several public APIs resolved products
 * against the static seed (src/data/products.ts) instead of the live
 * storefront catalog. These tests pin the fix:
 *
 *  1. Every engine/helper FAILS CLOSED without an explicit catalog —
 *     there is no implicit product list anywhere anymore.
 *  2. With a live catalog, seed ids (p01–p12) and demo slugs can never
 *     come back — not via baskets, viewed history, share links, bumps
 *     or support tools.
 *  3. The /api/recommendations ROUTE, run against a catalog overlay
 *     that mirrors production (demos deactivated, the five real books
 *     created), returns only real book ids.
 *  4. Source assertions: no migrated customer-facing file value-imports
 *     the seed list (type-only imports are fine).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "node:module";

// Route handlers use Next-style extensionless imports (and
// "next/server"), which plain Node cannot resolve. Same loader-hook
// pattern as tests/delivery-audit-fix.test.mjs: map them so the REAL
// recommendations route runs in this suite — no production code is
// altered for it.
const nextServerUrl = pathToFileURL(path.join(import.meta.dirname, "..", "node_modules", "next", "server.js")).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
      if (specifier === "next/server") return { url: ${JSON.stringify(nextServerUrl)}, shortCircuit: true };
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\\.(ts|tsx|js|mjs|json)$/.test(specifier)) {
        try { return await next(specifier + ".ts", context); } catch {}
        try { return await next(specifier + ".tsx", context); } catch {}
      }
      return next(specifier, context);
    }`),
);

// ─── Production-shaped catalog overlay (file mode) ──────────────────────────
// Mirrors the live store: the 12 demo products deactivated, the five
// real books created in the Manager's Office. Written BEFORE any module
// that resolves the catalog is imported.
const LIVE_BOOKS = [
  { id: "p-high-income-projects", slug: "high-income-projects", title: "High-Income Projects", subtitle: "Build a Business That Pays You Every Month", description: "Projects, offers and pricing systems.", category: "ebooks", formats: [{ format: "PDF", sizeMB: 2 }], priceUSD: 49, rating: 0, reviewsCount: 0, includes: ["PDF"], preview: "", hue: 43, publishedAt: "2026-11-01" },
  { id: "p-the-ai-wealth-engine", slug: "the-ai-wealth-engine", title: "The AI Wealth Engine", subtitle: "Turn AI into High Income", description: "AI services and offers.", category: "ebooks", formats: [{ format: "PDF", sizeMB: 3 }], priceUSD: 49, rating: 0, reviewsCount: 0, includes: ["PDF"], preview: "", hue: 222, publishedAt: "2026-11-01" },
  { id: "p-shopify-explosion", slug: "shopify-explosion", title: "Shopify Explosion", subtitle: "Turn Your Silent Store into a Daily Order Machine", description: "Shopify sales systems.", category: "ebooks", formats: [{ format: "PDF", sizeMB: 2 }], priceUSD: 39, rating: 0, reviewsCount: 0, includes: ["PDF"], preview: "", hue: 152, publishedAt: "2026-11-01" },
  { id: "p-be-a-pro-programmer-in-30-days", slug: "be-a-pro-programmer-in-30-days", title: "Be a Pro Programmer in 30 Days", subtitle: "From Zero to Launching Your Strongest Project", description: "A 30-day programming plan.", category: "ebooks", formats: [{ format: "PDF", sizeMB: 2 }], priceUSD: 39, rating: 0, reviewsCount: 0, includes: ["PDF"], preview: "", hue: 262, publishedAt: "2026-11-01" },
  { id: "p-4-luxury-classic-garment-designs", slug: "4-luxury-classic-garment-designs", title: "4 Luxury Classic Garment Designs", subtitle: "Designs That Set Your Sales on Fire", description: "Four garment designs, cut and sewn.", category: "design", formats: [{ format: "PDF", sizeMB: 2 }], priceUSD: 59, rating: 0, reviewsCount: 0, includes: ["PDF"], preview: "", hue: 350, publishedAt: "2026-11-01" },
];
const LIVE_IDS = new Set(LIVE_BOOKS.map((b) => b.id));
const SEED_IDS = ["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10", "p11", "p12"];
const DEMO_SLUGS = ["ai-profit-blueprint", "deep-focus-masterclass", "midnight-lofi-collection", "the-silent-ocean-audiobook", "notion-creator-templates", "astral-ui-kit-pro", "promptforge-studio", "french-for-travelers", "digital-marketing-playbook-2026", "piano-dreams-album", "brand-identity-mega-pack", "data-analysis-with-python"];

const workdir = mkdtempSync(path.join(tmpdir(), "astralium-fake-books-"));
process.chdir(workdir);
mkdirSync(path.join(workdir, ".data"), { recursive: true });
writeFileSync(
  path.join(workdir, ".data", "catalog-overrides.json"),
  JSON.stringify({ edits: {}, created: LIVE_BOOKS, deactivated: SEED_IDS }, null, 2),
);
delete process.env.DATABASE_URL;

const { scoreRecommendations, recommendationProducts } = await import("../src/lib/recommendations.ts");
const { searchProducts, suggestProducts } = await import("../src/lib/search.ts");
const { parseShareItems, encodeShareItems } = await import("../src/lib/share.ts");
const { resolveBumps } = await import("../src/lib/offers.ts");
const { sanitizeFlashSaleInput } = await import("../src/lib/flash-sales.ts");
const supportTools = await import("../src/lib/support-tools.ts");
const { searchCatalog } = await import("../src/services/ai-support.ts");

// ─── 1. Fail-closed: no catalog → nothing ───────────────────────────────────

test("recommendations engine fails closed without a catalog (no implicit list)", () => {
  assert.deepEqual(scoreRecommendations({ baskets: [["p01", "p02"], ["p01", "p02"]], targetId: "p01" }), []);
  assert.deepEqual(scoreRecommendations({ baskets: [], viewedIds: ["ai-profit-blueprint", "deep-focus-masterclass"] }), []);
  assert.deepEqual(scoreRecommendations({ baskets: [], targetId: "p01", catalog: [] }), []);
});

test("search + support search fail closed without a catalog", () => {
  assert.deepEqual(searchProducts("blueprint"), []);
  assert.deepEqual(searchProducts("python"), []);
  assert.deepEqual(suggestProducts("bluepr"), []);
  assert.deepEqual(searchCatalog("python course"), []);
  assert.deepEqual(supportTools.productSearch("AI Profit Blueprint"), []);
  assert.equal(supportTools.productDetails("ai-profit-blueprint"), null);
});

test("flash-sale sanitize fails closed without a catalog resolver", () => {
  assert.equal(sanitizeFlashSaleInput({
    name: "x", productIds: ["p01"], discountPercent: 20,
    startsAt: "2026-10-30T00:00:00.000Z", endsAt: "2026-10-31T00:00:00.000Z",
  }), null);
});

// ─── 2. Live catalog in → seed can never come out ───────────────────────────

test("engine with the live catalog: seed baskets/viewed can only yield real books", () => {
  const recs = scoreRecommendations({
    baskets: [["p01", "p02"], ["p01", "p09"], ["p-the-ai-wealth-engine", "p01"]],
    targetId: "p01",
    viewedIds: ["ai-profit-blueprint", "the-ai-wealth-engine", "data-analysis-with-python"],
    catalog: LIVE_BOOKS,
  });
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.ok(LIVE_IDS.has(r.productId), `seed/demo id leaked: ${r.productId}`);
    assert.ok(!SEED_IDS.includes(r.productId));
  }
  const products = recommendationProducts(recs, LIVE_BOOKS);
  assert.deepEqual(products.map((p) => p.id), recs.map((r) => r.productId));
  assert.deepEqual(recommendationProducts(recs, []), []);
});

test("share links validate against the caller's catalog only", () => {
  assert.deepEqual(parseShareItems("ai-profit-blueprint,deep-focus-masterclass", LIVE_BOOKS), []);
  assert.deepEqual(
    parseShareItems("the-ai-wealth-engine,ai-profit-blueprint", LIVE_BOOKS).map((p) => p.slug),
    ["the-ai-wealth-engine"],
  );
  assert.equal(encodeShareItems(["ai-profit-blueprint", "the-ai-wealth-engine"], LIVE_BOOKS), "the-ai-wealth-engine");
});

test("order bumps resolve only from the caller's catalog (fail-closed without it)", () => {
  const config = { "p-high-income-projects": { bump: { productId: "p-the-ai-wealth-engine", discountPercent: 10 } } };
  // No catalog → nothing resolves (the legacy 3-arg call is defused).
  assert.deepEqual(resolveBumps(["p-high-income-projects"], ["p-the-ai-wealth-engine"], config), []);
  const lines = resolveBumps(["p-high-income-projects"], ["p-the-ai-wealth-engine"], config, LIVE_BOOKS);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].productId, "p-the-ai-wealth-engine");
  assert.equal(lines[0].priceUSD, 44.1);
  // A config pointing at a demo product resolves nothing against the live catalog.
  const demoConfig = { "p-high-income-projects": { bump: { productId: "p02", discountPercent: 10 } } };
  assert.deepEqual(resolveBumps(["p-high-income-projects"], ["p02"], demoConfig, LIVE_BOOKS), []);
});

test("support product tools answer from the caller's catalog only", () => {
  assert.equal(supportTools.productDetails("ai-profit-blueprint", LIVE_BOOKS), null);
  const d = supportTools.productDetails("the-ai-wealth-engine", LIVE_BOOKS);
  assert.equal(d.title, "The AI Wealth Engine");
  assert.equal(d.priceUSD, 49);
  assert.equal(d.rating, 0); // the real book's real numbers — no invented ★4.9
  const found = supportTools.productSearch("wealth", 3, LIVE_BOOKS);
  assert.ok(found.some((p) => p.id === "p-the-ai-wealth-engine"));
  assert.deepEqual(supportTools.productSearch("python", 3, LIVE_BOOKS), []);
});

// ─── 3. The route itself, against the production-shaped catalog ────────────

test("GET /api/recommendations with viewed=the-ai-wealth-engine returns only real books", async () => {
  const { GET } = await import("../src/app/api/recommendations/route.ts");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest("http://localhost/api/recommendations?viewed=the-ai-wealth-engine"));
  assert.equal(res.status, 200);
  const raw = await res.text();
  for (const slug of DEMO_SLUGS) assert.ok(!raw.includes(slug), `demo slug in payload: ${slug}`);
  for (const title of ["Deep Focus", "AI Profit Blueprint", "Digital Marketing Playbook", "Data Analysis with Python"]) {
    assert.ok(!raw.includes(title), `demo title in payload: ${title}`);
  }
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.recommendations) && data.recommendations.length > 0);
  for (const item of data.recommendations) {
    assert.ok(LIVE_IDS.has(item.id), `non-live id in payload: ${item.id}`);
    assert.ok(item.product && item.product.id === item.id, "rail payload must carry the full product");
    assert.equal(item.product.rating, 0);
    assert.equal(item.product.reviewsCount, 0);
  }
});

test("GET /api/recommendations targeted at a demo product still returns only real books", async () => {
  const { GET } = await import("../src/app/api/recommendations/route.ts");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest("http://localhost/api/recommendations?productId=p01&viewed=ai-profit-blueprint"));
  assert.equal(res.status, 200);
  const data = await res.json();
  for (const item of data.recommendations) assert.ok(LIVE_IDS.has(item.id), `leak: ${item.id}`);
});

// ─── 4. Source assertions: no seed value-imports on customer surfaces ───────

const MIGRATED_FILES = [
  "src/lib/recommendations.ts",
  "src/lib/search.ts",
  "src/lib/search-db.ts",
  "src/lib/share.ts",
  "src/lib/offers.ts",
  "src/lib/flash-sales.ts",
  "src/lib/wishlist-alerts.ts",
  "src/lib/support-tools.ts",
  "src/services/ai-support.ts",
  "src/app/api/recommendations/route.ts",
  "src/app/api/offers/route.ts",
  "src/app/api/upsell/route.ts",
  "src/app/api/flash-sales/route.ts",
  "src/app/api/cart/recover/route.ts",
  "src/components/RecommendationsRail.tsx",
  "src/components/AccountClient.tsx",
  "src/components/CartClient.tsx",
  "src/components/WishlistExtras.tsx",
  "src/app/[locale]/wishlist/shared/page.tsx",
  "src/app/[locale]/product/[slug]/opengraph-image.tsx",
];

test("migrated customer-facing files never value-import the seed list", () => {
  const root = path.join(import.meta.dirname, "..");
  for (const rel of MIGRATED_FILES) {
    const src = readFileSync(path.join(root, rel), "utf8");
    for (const line of src.split("\n")) {
      if (!/from\s+["'][^"']*data\/products["']/.test(line)) continue;
      const okTypeOnly = /^\s*import\s+type\b/.test(line) || /\{\s*(type\s+[\w$]+\s*,?\s*)+\}/.test(line);
      assert.ok(okTypeOnly, `${rel} value-imports the seed list: ${line.trim()}`);
    }
  }
});
