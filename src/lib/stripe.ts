/**
 * Stripe API constants (Phase 1 upgrade, security §8).
 *
 * The apiVersion is PINNED: an unpinned integration silently follows
 * the account's default version, so a dashboard-side change could alter
 * payload shapes under the webhooks. Every server-side Stripe call
 * sends this header. Bump deliberately, with the changelog reviewed.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_API_VERSION = "2024-06-20";

/**
 * Verify a Stripe webhook signature (manual HMAC scheme: the signed
 * payload is "<t>.<rawBody>", HMAC-SHA-256 under the webhook secret,
 * compared in constant time; timestamps older than 5 minutes are
 * rejected as replay protection). Extracted from the webhook route so
 * the penetration suite tests the exact shipped code.
 */
export function verifyStripeWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function stripeHeaders(secretKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
}
