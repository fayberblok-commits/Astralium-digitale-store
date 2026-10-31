/**
 * Order-access binding (Phase 1 upgrade, security §7).
 *
 * A Stripe session_id is a capability: anyone holding it could view
 * the success page. Full buyer data (receipt PDF, re-delivery) is
 * therefore bound to a short-lived httpOnly cookie minted ONLY after
 * the server verifies the payment: value = HMAC("order-access"
 * purpose key, orderId). The cookie proves "this browser completed
 * the verified success flow for this order" without exposing the
 * buyer's email or any reusable credential.
 */
import { purposeHmac, purposeHmacVerify } from "./keys.ts";

export const ORDER_ACCESS_COOKIE = "astralium-order-access";
export const ORDER_ACCESS_TTL_SECONDS = 60 * 60; // 1 hour

export function orderAccessToken(orderId: string): string | null {
  return purposeHmac("order-access", `order:${orderId}`);
}

export function verifyOrderAccess(cookieValue: string | undefined, orderId: string): boolean {
  if (!cookieValue) return false;
  return purposeHmacVerify("order-access", `order:${orderId}`, cookieValue);
}
