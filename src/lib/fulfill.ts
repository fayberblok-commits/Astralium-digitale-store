/**
 * Payment verification + fulfilment shared by the success page and
 * webhooks. A download token is issued ONLY after the provider confirms
 * the payment server-side — never from client claims.
 */
import { createDownloadToken } from "./tokens";
import { getProductById } from "../data/products";

export interface VerifiedOrder {
  orderId: string;
  email: string | null;
  productIds: string[];
  provider: "stripe";
}

export async function verifyStripeSession(sessionId: string): Promise<VerifiedOrder | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !sessionId.startsWith("cs_")) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}` },
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
