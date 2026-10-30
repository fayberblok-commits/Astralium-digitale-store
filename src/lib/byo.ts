/**
 * Bundle math (Phase 3, feature 3) — pure functions shared by the
 * storefront widget, the admin panel and the checkout route.
 *
 * Two bundle kinds:
 *  - Owner bundles: a fixed set of products at `discountPercent` off the
 *    summed catalog prices. The price is ALWAYS derived server-side from
 *    catalog prices — never accepted from a client.
 *  - Build-your-own (BYO): any 3+ distinct products in one order earn an
 *    automatic BYO_RATE discount on those products' subtotal. 2 items
 *    earn nothing. Bundle line items themselves do not count toward BYO.
 */

export const BYO_MIN_ITEMS = 3;
export const BYO_RATE = 0.15;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PricedItem {
  id: string;
  priceUSD: number;
}

/** Derived price of an owner bundle from catalog prices + discount %. */
export function computeBundlePrice(
  productIds: string[],
  discountPercent: number,
  catalog: PricedItem[],
): { sumUSD: number; priceUSD: number; savingsUSD: number } {
  const byId = new Map(catalog.map((p) => [p.id, p.priceUSD]));
  const sum = productIds.reduce((s, id) => s + (byId.get(id) ?? 0), 0);
  const pct = Math.min(90, Math.max(0, discountPercent));
  const price = round2(sum * (1 - pct / 100));
  return { sumUSD: round2(sum), priceUSD: price, savingsUSD: round2(sum - price) };
}

export interface ByoResult {
  eligible: boolean;
  distinctProducts: number;
  discountUSD: number;
  rate: number;
}

/**
 * BYO discount for a set of distinct product ids (prices resolved from
 * the catalog). Duplicate ids count once — one license per product.
 */
export function byoDiscount(productIds: string[], catalog: PricedItem[]): ByoResult {
  const byId = new Map(catalog.map((p) => [p.id, p.priceUSD]));
  const distinct = Array.from(new Set(productIds)).filter((id) => byId.has(id));
  if (distinct.length < BYO_MIN_ITEMS) {
    return { eligible: false, distinctProducts: distinct.length, discountUSD: 0, rate: BYO_RATE };
  }
  const subtotal = distinct.reduce((s, id) => s + (byId.get(id) ?? 0), 0);
  return {
    eligible: true,
    distinctProducts: distinct.length,
    discountUSD: round2(subtotal * BYO_RATE),
    rate: BYO_RATE,
  };
}
