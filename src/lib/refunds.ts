/**
 * Provider refund execution (Phase 4 upgrade — Manager's Office).
 *
 * The office refund button talks to the REAL provider APIs, following
 * the same raw-fetch pattern as checkout (lib/stripe.ts pins the API
 * version):
 *   Stripe — resolve the checkout session's payment_intent, then
 *            POST /v1/refunds (amount in cents for a partial refund).
 *   PayPal — resolve the order's capture, then
 *            POST /v2/payments/captures/{id}/refund.
 *
 * The ledger is only updated by the caller AFTER this returns ok —
 * a refund that the provider did not accept is never recorded as
 * refunded. When the provider is not configured the function refuses
 * with PAYMENTS_NOT_CONFIGURED; it never fakes a refund.
 */
import { STRIPE_API_VERSION } from "./stripe.ts";
import type { OrderRecord } from "./orders.ts";

export type RefundOutcome =
  | { ok: true; providerRefundId: string }
  | { ok: false; error: string };

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function refundStripe(order: OrderRecord, amountUSD: number, full: boolean): Promise<RefundOutcome> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "PAYMENTS_NOT_CONFIGURED" };
  const headers = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": STRIPE_API_VERSION,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // The ledger's providerRef is the Checkout Session id — resolve its
  // payment intent first (a session id cannot be refunded directly).
  const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.providerRef)}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION },
  });
  const session = (await sessionRes.json().catch(() => ({}))) as { payment_intent?: string | { id?: string }; error?: { message?: string } };
  if (!sessionRes.ok) return { ok: false, error: session.error?.message ?? "STRIPE_SESSION_LOOKUP_FAILED" };
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntent) return { ok: false, error: "NO_PAYMENT_INTENT" };
  const form = new URLSearchParams();
  form.set("payment_intent", paymentIntent);
  if (!full) form.set("amount", String(Math.round(amountUSD * 100)));
  const res = await fetch("https://api.stripe.com/v1/refunds", { method: "POST", headers, body: form });
  const refund = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !refund.id) return { ok: false, error: refund.error?.message ?? "STRIPE_REFUND_FAILED" };
  return { ok: true, providerRefundId: refund.id };
}

async function paypalAccessToken(): Promise<string | null> {
  const base = process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

async function refundPaypal(order: OrderRecord, amountUSD: number, full: boolean): Promise<RefundOutcome> {
  if (!paypalConfigured()) return { ok: false, error: "PAYMENTS_NOT_CONFIGURED" };
  const base = process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  const token = await paypalAccessToken();
  if (!token) return { ok: false, error: "PAYPAL_AUTH_FAILED" };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // providerRef is the PayPal ORDER id — a refund targets its capture.
  const orderRes = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(order.providerRef)}`, { headers });
  const orderData = (await orderRes.json().catch(() => ({}))) as {
    purchase_units?: { payments?: { captures?: { id?: string; status?: string }[] } }[];
  };
  if (!orderRes.ok) return { ok: false, error: "PAYPAL_ORDER_LOOKUP_FAILED" };
  const capture = orderData.purchase_units?.[0]?.payments?.captures?.find((c) => c.id);
  if (!capture?.id) return { ok: false, error: "NO_CAPTURE_FOUND" };
  const res = await fetch(`${base}/v2/payments/captures/${capture.id}/refund`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      full ? {} : { amount: { value: amountUSD.toFixed(2), currency_code: order.currency || "USD" } },
    ),
  });
  const refund = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !refund.id) return { ok: false, error: "PAYPAL_REFUND_FAILED" };
  return { ok: true, providerRefundId: refund.id };
}

/** Execute a refund with the order's provider. `full` refunds the remaining balance. */
export async function executeProviderRefund(order: OrderRecord, amountUSD: number, full: boolean): Promise<RefundOutcome> {
  try {
    if (order.provider === "stripe") return await refundStripe(order, amountUSD, full);
    if (order.provider === "paypal") return await refundPaypal(order, amountUSD, full);
    return { ok: false, error: "UNKNOWN_PROVIDER" };
  } catch {
    return { ok: false, error: "PROVIDER_UNREACHABLE" };
  }
}
