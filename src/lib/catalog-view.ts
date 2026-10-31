/**
 * Pure catalog presentation helpers (Phase 3 upgrade).
 *
 * The filtering/sorting/collection logic for the shop page lives here —
 * framework-free — so the client catalog and the unit tests exercise
 * exactly the same code. The products fed in always come from the
 * Phase-1 catalog resolver (database-first); nothing here ever reads
 * the static seed directly.
 */
import type { Product } from "../data/products.ts";

export type CatalogSortKey = "featured" | "price-asc" | "price-desc" | "rating" | "newest" | "popularity";

export type CollectionId = "all" | "bestsellers" | "new" | "under25" | "toprated";

export const COLLECTION_IDS: CollectionId[] = ["all", "bestsellers", "new", "under25", "toprated"];

/** Whole-percent discount of `priceUSD` vs `compareAtUSD` (0 when none). */
export function discountPercent(p: Pick<Product, "priceUSD" | "compareAtUSD">): number {
  if (!p.compareAtUSD || p.compareAtUSD <= p.priceUSD || p.priceUSD < 0) return 0;
  return Math.round((1 - p.priceUSD / p.compareAtUSD) * 100);
}

/** Products published within the last 120 days count as "new releases". */
const NEW_WINDOW_DAYS = 120;

export function applyCollection(products: Product[], collection: CollectionId, now: Date = new Date()): Product[] {
  switch (collection) {
    case "bestsellers":
      return products.filter((p) => p.badge === "bestseller");
    case "new": {
      const cutoff = now.getTime() - NEW_WINDOW_DAYS * 86400000;
      return products.filter((p) => p.badge === "new" || new Date(p.publishedAt).getTime() >= cutoff);
    }
    case "under25":
      return products.filter((p) => p.priceUSD < 25);
    case "toprated":
      return products.filter((p) => p.rating >= 4.8);
    default:
      return [...products];
  }
}

export function sortProducts(products: Product[], sort: CatalogSortKey): Product[] {
  const list = [...products];
  switch (sort) {
    case "price-asc":
      return list.sort((a, b) => a.priceUSD - b.priceUSD);
    case "price-desc":
      return list.sort((a, b) => b.priceUSD - a.priceUSD);
    case "rating":
      return list.sort((a, b) => b.rating - a.rating || b.reviewsCount - a.reviewsCount);
    case "newest":
      return list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    case "popularity":
      return list.sort((a, b) => b.reviewsCount - a.reviewsCount || b.rating - a.rating);
    default: // featured: bestsellers first, then most reviewed
      return list.sort(
        (a, b) =>
          (b.badge === "bestseller" ? 1 : 0) - (a.badge === "bestseller" ? 1 : 0) ||
          b.reviewsCount - a.reviewsCount,
      );
  }
}
