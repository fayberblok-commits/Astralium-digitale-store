/**
 * Coupon engine — pure functions, fully unit-testable.
 *
 * Supports: percent / fixed-amount, first-order-only, country-restricted,
 * minimum subtotal, global usage limits and expiry. Codes are stored
 * uppercase; validation is case-insensitive.
 */

export interface Coupon {
  code: string;
  type: "percent" | "fixed";
  /** percent (0-100) when type=percent, USD amount when type=fixed */
  value: number;
  firstOrderOnly?: boolean;
  /** ISO country codes; empty/undefined = all countries */
  countries?: string[];
  minSubtotalUSD?: number;
  /** total redemptions allowed store-wide */
  usageLimit?: number;
  expiresAt?: string; // ISO date
  active: boolean;
}

export const COUPONS: Coupon[] = [
  { code: "WELCOME10", type: "percent", value: 10, firstOrderOnly: true, active: true },
  { code: "STUDENT20", type: "percent", value: 20, minSubtotalUSD: 30, active: true },
  { code: "MENA15", type: "percent", value: 15, countries: ["MA", "EG", "SA", "AE", "DZ", "TN"], active: true },
  { code: "FLASH5", type: "fixed", value: 5, usageLimit: 500, active: true },
  { code: "EXPIRED50", type: "percent", value: 50, expiresAt: "2025-01-01", active: true },
  { code: "PAUSED25", type: "percent", value: 25, active: false },
];

export interface CouponContext {
  isFirstOrder: boolean;
  country?: string; // ISO code, if known
  usageCount?: number; // redemptions so far (from the data layer)
  now?: Date;
}

export type CouponResult =
  | { ok: true; coupon: Coupon; discountUSD: number }
  | { ok: false; reason: string };

export function findCoupon(code: string): Coupon | undefined {
  return COUPONS.find((c) => c.code === code.trim().toUpperCase());
}

export function applyCoupon(
  rawCode: string,
  subtotalUSD: number,
  ctx: CouponContext,
): CouponResult {
  const coupon = findCoupon(rawCode);
  if (!coupon) return { ok: false, reason: "not-found" };
  if (!coupon.active) return { ok: false, reason: "inactive" };
  const now = ctx.now ?? new Date();
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (coupon.firstOrderOnly && !ctx.isFirstOrder) {
    return { ok: false, reason: "first-order-only" };
  }
  if (coupon.countries && coupon.countries.length > 0) {
    if (!ctx.country || !coupon.countries.includes(ctx.country.toUpperCase())) {
      return { ok: false, reason: "country-restricted" };
    }
  }
  if (coupon.minSubtotalUSD !== undefined && subtotalUSD < coupon.minSubtotalUSD) {
    return { ok: false, reason: "below-minimum" };
  }
  if (coupon.usageLimit !== undefined && (ctx.usageCount ?? 0) >= coupon.usageLimit) {
    return { ok: false, reason: "usage-limit-reached" };
  }
  let discount =
    coupon.type === "percent" ? (subtotalUSD * coupon.value) / 100 : coupon.value;
  discount = Math.min(discount, subtotalUSD); // never negative totals
  discount = Math.round(discount * 100) / 100;
  return { ok: true, coupon, discountUSD: discount };
}

export function priceCart(subtotalUSD: number, discountUSD: number): { subtotal: number; discount: number; total: number } {
  const discount = Math.min(Math.max(0, discountUSD), subtotalUSD);
  return {
    subtotal: Math.round(subtotalUSD * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round((subtotalUSD - discount) * 100) / 100,
  };
}
