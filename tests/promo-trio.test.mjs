import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Promo trio (owner order 2026-11-07): every book's product page shows
// THREE designed promotional images as a dedicated set. Assets only —
// no env, no database.
const { promoImagesFor } = await import("../src/assets/promos.ts");
const { getDictionary } = await import("../src/i18n/dictionaries.ts");

const BOOK_IDS = [
  "p-high-income-projects",
  "p-the-ai-wealth-engine",
  "p-shopify-explosion",
  "p-be-a-pro-programmer-in-30-days",
  "p-4-luxury-classic-garment-designs",
];

test("promo trio: each of the five books maps to exactly three WebP data URIs", () => {
  for (const id of BOOK_IDS) {
    const images = promoImagesFor(id);
    assert.ok(images, id);
    assert.equal(images.length, 3, id);
    for (const uri of images) {
      assert.ok(uri.startsWith("data:image/webp;base64,"), id);
      // ~120KB budget per image (base64 inflates bytes by ~4/3).
      const bytes = Math.floor(((uri.length - 22) * 3) / 4);
      assert.ok(bytes <= 120 * 1024, `${id}: ${bytes} bytes`);
    }
    // The three cards of a trio are three different images.
    assert.equal(new Set(images).size, 3, id);
  }
});

test("promo trio: unknown products have no trio", () => {
  assert.equal(promoImagesFor("p01"), null);
  assert.equal(promoImagesFor("does-not-exist"), null);
});

test("promo trio: heading and captions exist natively in English and Arabic", () => {
  for (const locale of ["en", "ar"]) {
    const dict = getDictionary(locale);
    for (const key of ["promo_t", "promo_c1", "promo_c2", "promo_c3"]) {
      assert.ok(dict[key] && dict[key].length > 0, `${locale}:${key}`);
    }
  }
});

test("promo trio: product page renders the component and CSS ships the layout", () => {
  const page = readFileSync("src/app/[locale]/product/[slug]/page.tsx", "utf8");
  assert.ok(page.includes("PromoTrio"), "page imports/renders PromoTrio");
  assert.ok(page.includes("product.description"), "description still rendered");
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.ok(css.includes(".promo-trio"), "trio grid styles present");
  assert.ok(css.includes(".promo-card"), "card styles present");
});
