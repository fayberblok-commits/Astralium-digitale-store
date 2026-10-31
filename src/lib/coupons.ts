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
  return findCouponIn(COUPONS, code);
}

/** List-parameterized lookup (Phase 4 upgrade: the office-managed list). */
export function findCouponIn(list: Coupon[], code: string): Coupon | undefined {
  return list.find((c) => c.code === code.trim().toUpperCase());
}

export function applyCoupon(
  rawCode: string,
  subtotalUSD: number,
  ctx: CouponContext,
): CouponResult {
  return applyCouponIn(COUPONS, rawCode, subtotalUSD, ctx);
}

/** List-parameterized evaluation — the pure engine behind applyCoupon. */
export function applyCouponIn(
  list: Coupon[],
  rawCode: string,
  subtotalUSD: number,
  ctx: CouponContext,
): CouponResult {
  const coupon = findCouponIn(list, rawCode);
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

// ─── Office-managed list sanitizers (pure; the store lives server-side) ──────

export function sanitizeCoupon(raw: unknown): Coupon | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Coupon>;
  const code = typeof r.code === "string" ? r.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40) : "";
  if (!code) return null;
  if (r.type !== "percent" && r.type !== "fixed") return null;
  const value = typeof r.value === "number" && Number.isFinite(r.value) ? r.value : NaN;
  if (!Number.isFinite(value) || value <= 0 || (r.type === "percent" && value > 100)) return null;
  const out: Coupon = { code, type: r.type, value: Math.round(value * 100) / 100, active: r.active !== false };
  if (r.firstOrderOnly === true) out.firstOrderOnly = true;
  if (Array.isArray(r.countries)) {
    const countries = r.countries.filter((c): c is string => typeof c === "string").map((c) => c.toUpperCase().slice(0, 2));
    if (countries.length > 0) out.countries = countries;
  }
  if (typeof r.minSubtotalUSD === "number" && r.minSubtotalUSD > 0) out.minSubtotalUSD = r.minSubtotalUSD;
  if (typeof r.usageLimit === "number" && r.usageLimit > 0) out.usageLimit = Math.floor(r.usageLimit);
  if (typeof r.expiresAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.expiresAt)) out.expiresAt = r.expiresAt.slice(0, 10);
  return out;
}

/** Sanitize a whole coupon list (dedupes by code; non-array → the seed list). */
export function sanitizeCouponList(raw: unknown): Coupon[] {
  if (!Array.isArray(raw)) return COUPONS.map((c) => ({ ...c }));
  const seen = new Set<string>();
  const out: Coupon[] = [];
  for (const item of raw) {
    const c = sanitizeCoupon(item);
    if (c && !seen.has(c.code)) {
      seen.add(c.code);
      out.push(c);
    }
  }
  return out.slice(0, 200);
}

export function priceCart(subtotalUSD: number, discountUSD: number): { subtotal: number; discount: number; total: number } {
  const discount = Math.min(Math.max(0, discountUSD), subtotalUSD);
  return {
    subtotal: Math.round(subtotalUSD * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round((subtotalUSD - discount) * 100) / 100,
  };
}
