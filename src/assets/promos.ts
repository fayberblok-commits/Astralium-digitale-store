/**
 * Promotional trios for the five books, keyed by the live catalog
 * product id. Each book has THREE designed promo cards (cover
 * showcase, a real look-inside page, and a by-the-numbers card built
 * only from verified product facts) shipped as WebP data-URI modules
 * — the same pattern as covers.ts / hero-art.ts. Products not listed
 * here simply render no trio (the component returns null).
 */
import { PROMO_PROJECTS_1_DATA_URI } from "./promo-projects-1.ts";
import { PROMO_PROJECTS_2_DATA_URI } from "./promo-projects-2.ts";
import { PROMO_PROJECTS_3_DATA_URI } from "./promo-projects-3.ts";
import { PROMO_AI_WEALTH_1_DATA_URI } from "./promo-ai-wealth-1.ts";
import { PROMO_AI_WEALTH_2_DATA_URI } from "./promo-ai-wealth-2.ts";
import { PROMO_AI_WEALTH_3_DATA_URI } from "./promo-ai-wealth-3.ts";
import { PROMO_SHOPIFY_1_DATA_URI } from "./promo-shopify-1.ts";
import { PROMO_SHOPIFY_2_DATA_URI } from "./promo-shopify-2.ts";
import { PROMO_SHOPIFY_3_DATA_URI } from "./promo-shopify-3.ts";
import { PROMO_PROGRAMMING_1_DATA_URI } from "./promo-programming-1.ts";
import { PROMO_PROGRAMMING_2_DATA_URI } from "./promo-programming-2.ts";
import { PROMO_PROGRAMMING_3_DATA_URI } from "./promo-programming-3.ts";
import { PROMO_DESIGNS_1_DATA_URI } from "./promo-designs-1.ts";
import { PROMO_DESIGNS_2_DATA_URI } from "./promo-designs-2.ts";
import { PROMO_DESIGNS_3_DATA_URI } from "./promo-designs-3.ts";

export type PromoTrioImages = readonly [string, string, string];

const PROMOS: Record<string, PromoTrioImages> = {
  "p-high-income-projects": [
    PROMO_PROJECTS_1_DATA_URI,
    PROMO_PROJECTS_2_DATA_URI,
    PROMO_PROJECTS_3_DATA_URI,
  ],
  "p-the-ai-wealth-engine": [
    PROMO_AI_WEALTH_1_DATA_URI,
    PROMO_AI_WEALTH_2_DATA_URI,
    PROMO_AI_WEALTH_3_DATA_URI,
  ],
  "p-shopify-explosion": [
    PROMO_SHOPIFY_1_DATA_URI,
    PROMO_SHOPIFY_2_DATA_URI,
    PROMO_SHOPIFY_3_DATA_URI,
  ],
  "p-be-a-pro-programmer-in-30-days": [
    PROMO_PROGRAMMING_1_DATA_URI,
    PROMO_PROGRAMMING_2_DATA_URI,
    PROMO_PROGRAMMING_3_DATA_URI,
  ],
  "p-4-luxury-classic-garment-designs": [
    PROMO_DESIGNS_1_DATA_URI,
    PROMO_DESIGNS_2_DATA_URI,
    PROMO_DESIGNS_3_DATA_URI,
  ],
};

export function promoImagesFor(productId: string): PromoTrioImages | null {
  return PROMOS[productId] ?? null;
}
