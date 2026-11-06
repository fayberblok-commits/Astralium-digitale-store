/**
 * Payment verification + fulfilment shared by the success page and
 * webhooks. A download token is issued ONLY after the provider confirms
 * the payment server-side — never from client claims.
 */
import { createDownloadToken } from "./tokens";
import { STRIPE_API_VERSION } from "./stripe";
import { getProductById } from "../data/products";
import { getOrderByRef } from "./orders";

export interface VerifiedOrder {
  orderId: string;
  email: string | null;
  productIds: string[];
  provider: "stripe" | "paypal";
}

export async function verifyStripeSession(sessionId: string): Promise<VerifiedOrder | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !sessionId.startsWith("cs_")) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION },
    });
    if (!res.ok) return null;
    const s = (await res.json()) as {
      payment_status?: string;
      client_reference_id?: string;
      customer_details?: { email?: string };
      metadata?: { product_ids?: string; order_id?: string };
    };
    if (s.payment_status !== "paid") return null;
    const productIds = (s.metadata?.product_ids ?? "").split(",").filter(Boolean);
    return {
      orderId: s.metadata?.order_id || s.client_reference_id || sessionId,
      email: s.customer_details?.email ?? null,
      productIds,
      provider: "stripe",
    };
  } catch {
    return null;
  }
}

/**
 * Verify a PayPal order for the success page (owner fix, 2026-11).
 *
 * The lookup key is the PAYPAL order id — an unguessable provider
 * token the buyer only learns from their own payment flow (the SDK
 * capture response hands it to our success URL as `?po=`; the
 * redirect flow returns with PayPal's own `token=` parameter). We
 * deliberately do NOT verify by the store's `AST-…` order id: those
 * are timestamp-derived and enumerable.
 *
 * Verification is ledger-based: the order must be PAID or FULFILLED
 * in our own ledger, which only the capture/webhook money pipeline
 * can produce (PAID only from PENDING). A merely-approved or pending
 * PayPal order verifies nothing and issues no downloads.
 */
export async function verifyPaypalOrder(providerOrderId: string): Promise<VerifiedOrder | null> {
  if (!providerOrderId || !/^[A-Za-z0-9_-]{6,64}$/.test(providerOrderId)) return null;
  const order = await getOrderByRef(providerOrderId).catch(() => null);
  if (!order || order.provider !== "paypal") return null;
  if (order.status !== "paid" && order.status !== "fulfilled") return null;
  return {
    orderId: order.id,
    email: order.email || null,
    productIds: order.items.map((item) => item.productId),
    provider: "paypal",
  };
}

/** Build signed download URLs for a verified order. */
export function downloadLinksFor(order: VerifiedOrder): { productId: string; title: string; url: string }[] {
  return order.productIds
    .map((pid) => getProductById(pid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      productId: p.id,
      title: p.title,
      url: `/api/download/${createDownloadToken(p.id, order.orderId)}`,
    }));
}
