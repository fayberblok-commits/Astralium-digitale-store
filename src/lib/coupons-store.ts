/**
 * Office-managed coupon list (Phase 4 upgrade — server-only).
 *
 * The coupon CATALOG used to be a compile-time constant. It now lives
 * in the JSON config store (DB Setting / .data/coupons.json), seeded
 * from the static COUPONS list on first read; the Manager's Office
 * edits it (create / toggle / delete) and the checkout + validation
 * routes evaluate against THIS list via applyCouponIn. The pure
 * engine stays in lib/coupons.ts (client-safe — it is imported by the
 * cart for price math); this module is the server-side store and must
 * never be imported by a client component.
 */
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { COUPONS, sanitizeCouponList, type Coupon } from "./coupons.ts";

export async function getCoupons(): Promise<Coupon[]> {
  return getJsonConfig<Coupon[]>("coupons_v1", "coupons.json", sanitizeCouponList, COUPONS.map((c) => ({ ...c })));
}

export async function setCoupons(list: Coupon[]): Promise<{ persisted: "db" | "file"; value: Coupon[] }> {
  return setJsonConfig("coupons_v1", "coupons.json", sanitizeCouponList(list), sanitizeCouponList);
}
