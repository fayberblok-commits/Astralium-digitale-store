/**
 * Real printed covers for the five books, keyed by the live catalog
 * product id. Each cover ships as a WebP data-URI module (the
 * hero-art.ts precedent) so the artwork travels inside the bundle
 * with no separate binary upload. Products not listed here keep the
 * CSS-generated duotone cover (components/Cover.tsx fallback).
 */
import { COVER_PROJECTS_DATA_URI } from "./cover-projects";
import { COVER_AI_WEALTH_DATA_URI } from "./cover-ai-wealth";
import { COVER_SHOPIFY_DATA_URI } from "./cover-shopify";
import { COVER_PROGRAMMING_DATA_URI } from "./cover-programming";
import { COVER_DESIGNS_DATA_URI } from "./cover-designs";

const COVERS: Record<string, string> = {
  "p-high-income-projects": COVER_PROJECTS_DATA_URI,
  "p-the-ai-wealth-engine": COVER_AI_WEALTH_DATA_URI,
  "p-shopify-explosion": COVER_SHOPIFY_DATA_URI,
  "p-be-a-pro-programmer-in-30-days": COVER_PROGRAMMING_DATA_URI,
  "p-4-luxury-classic-garment-designs": COVER_DESIGNS_DATA_URI,
};

export function coverImageFor(productId: string): string | null {
  return COVERS[productId] ?? null;
}
