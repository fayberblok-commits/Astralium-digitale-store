/**
 * Wishlist share links (Phase 3, feature 8) — pure + client-safe.
 * Encodes product SLUGS in the URL (no account, no PII); parsing
 * validates every slug against the catalog and de-duplicates.
 */
import { getProductBySlug, type Product } from "../data/products.ts";

export function encodeShareItems(slugs: string[]): string {
  const valid = slugs.filter((s) => getProductBySlug(s));
  return valid.join(",");
}

export function parseShareItems(raw: string | null | undefined): Product[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const slug of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const p = getProductBySlug(slug);
    if (p) out.push(p);
  }
  return out;
}
