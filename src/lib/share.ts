/**
 * Wishlist share links (Phase 3, feature 8) — pure + client-safe.
 * Encodes product SLUGS in the URL (no account, no PII); parsing
 * validates every slug against the catalog the CALLER supplies and
 * de-duplicates.
 *
 * Catalog discipline (register item 82 fix): the catalog is an explicit
 * parameter — the live storefront catalog in production. This module
 * holds no product list of its own, so a shared link can only ever
 * render products that are actually on sale.
 */
import type { Product } from "../data/products.ts";

export function encodeShareItems(slugs: string[], catalog: Product[]): string {
  const valid = new Set(catalog.map((p) => p.slug));
  return slugs.filter((s) => valid.has(s)).join(",");
}

export function parseShareItems(raw: string | null | undefined, catalog: Product[]): Product[] {
  if (!raw) return [];
  const bySlug = new Map(catalog.map((p) => [p.slug, p]));
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const slug of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const p = bySlug.get(slug);
    if (p) out.push(p);
  }
  return out;
}
