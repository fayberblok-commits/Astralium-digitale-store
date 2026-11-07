/**
 * Recommendations (Phase 3, feature 5) — explainable, privacy-safe.
 *
 * Scoring inputs are ORDER ITEM LISTS ONLY (arrays of product ids). The
 * aggregator's input type has no email/customer field at all, so PII can
 * never leak through it: co-purchase counts are computed from anonymous
 * baskets. When no order data exists (no DB / no sales yet), the engine
 * falls back to catalog affinity: same category first, then top rated.
 *
 * Every recommendation carries a machine-readable reason code the UI
 * renders as a label: "also_bought" | "similar_category" | "top_rated".
 *
 * CATALOG DISCIPLINE (register item 82 fix): the engine scores ONLY the
 * catalog the caller passes in — in production that is the LIVE
 * storefront catalog (lib/catalog.ts). There is deliberately NO default
 * catalog: omitting it yields zero recommendations (fail-closed), so
 * the static seed list can never leak onto a customer surface again.
 */
import type { Product } from "../data/products.ts";

export type ReasonCode = "also_bought" | "similar_category" | "top_rated";

export interface ScoredRecommendation {
  productId: string;
  score: number;
  reason: ReasonCode;
  /** For also_bought: how many baskets contained both products. */
  coCount?: number;
}

export interface RecommendationInput {
  /** Anonymous baskets: product-id arrays, one per order. No PII. */
  baskets: string[][];
  /** Product the customer is looking at / has in the cart (optional). */
  targetId?: string;
  /** Products the customer viewed (ids or slugs, from local view history). */
  viewedIds?: string[];
  /** Products to exclude (already owned / in cart). */
  excludeIds?: string[];
  /** The ONLY catalog that may be scored — the live storefront catalog
   *  in production. Required: there is no implicit fallback list. */
  catalog: Product[];
  limit?: number;
}

/** Count co-occurrences of `targetId` with every other product. */
export function coPurchaseCounts(baskets: string[][], targetId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const basket of baskets) {
    if (!basket.includes(targetId)) continue;
    for (const id of new Set(basket)) {
      if (id === targetId) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export function scoreRecommendations(input: RecommendationInput): ScoredRecommendation[] {
  // Fail-closed: a caller that forgets the catalog gets NO recommendations
  // rather than a fallback list (the seed leak of register item 82).
  const catalog = input.catalog ?? [];
  const limit = input.limit ?? 4;
  const exclude = new Set<string>(input.excludeIds ?? []);
  if (input.targetId) exclude.add(input.targetId);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const resolve = (idOrSlug: string): string | undefined =>
    byId.has(idOrSlug) ? idOrSlug : catalog.find((p) => p.slug === idOrSlug)?.id;

  const scores = new Map<string, ScoredRecommendation>();
  const bump = (id: string, add: number, reason: ReasonCode, coCount?: number) => {
    if (exclude.has(id) || !byId.has(id)) return;
    const cur = scores.get(id);
    if (cur) {
      cur.score += add;
      // Reason priority: a real co-purchase signal outranks affinity.
      if (reason === "also_bought") { cur.reason = "also_bought"; cur.coCount = coCount; }
    } else {
      scores.set(id, { productId: id, score: add, reason, coCount });
    }
  };

  // 1) Co-purchase signal (strongest) — needs a target and order data.
  if (input.targetId && input.baskets.length > 0) {
    for (const [id, count] of coPurchaseCounts(input.baskets, input.targetId)) {
      bump(id, 100 + count * 10, "also_bought", count);
    }
  }

  // 2) Affinity from the target + viewed products: same category.
  const seeds = new Set<string>();
  if (input.targetId) seeds.add(input.targetId);
  for (const v of input.viewedIds ?? []) {
    const id = resolve(v);
    if (id) seeds.add(id);
  }
  const seedCategories = new Set(
    Array.from(seeds).map((id) => byId.get(id)?.category).filter(Boolean),
  );
  for (const p of catalog) {
    if (exclude.has(p.id)) continue;
    if (seedCategories.has(p.category)) bump(p.id, 40 + p.rating, "similar_category");
  }

  // 3) Top-rated fill (also the no-data fallback ordering).
  for (const p of catalog) {
    if (exclude.has(p.id)) continue;
    bump(p.id, p.rating, "top_rated");
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score || (byId.get(b.productId)?.rating ?? 0) - (byId.get(a.productId)?.rating ?? 0))
    .slice(0, limit);
}

/** Baskets from DB order rows — ids only; emails never enter this module. */
export function basketsFromOrders(orders: { items: { productId: string }[] }[]): string[][] {
  return orders.map((o) => o.items.map((i) => i.productId));
}

/** Resolve scored recommendations against the SAME catalog that was
 *  scored — never against any other product list. */
export function recommendationProducts(recs: ScoredRecommendation[], catalog: Product[]): Product[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return recs
    .map((r) => byId.get(r.productId))
    .filter((p): p is Product => Boolean(p));
}
