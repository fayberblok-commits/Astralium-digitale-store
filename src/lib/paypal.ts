/**
 * Shared PayPal server logic (owner fix, 2026-11).
 *
 * One money pipeline for every PayPal entry point — the redirect
 * checkout (POST /api/checkout), the on-page JS SDK flow
 * (POST /api/checkout/capture) and the webhook
 * (POST /api/webhooks/paypal) — so order creation, capture and
 * fulfilment can never drift apart. Fulfilment goes exclusively
 * through the order ledger: `markPaidAndGrant` is the only path to
 * PAID, and it only accepts PENDING orders.
 *
 * Checkout email is OPTIONAL (see lib/checkout-rules.ts): when the
 * buyer skipped it, the payer email PayPal returns with the capture
 * is stored on the order (fill-only, never overwriting a typed
 * email) so the receipt and delivery records still have an address.
 * Delivery itself never depends on email — the success page issues
 * the signed download links.
 */
import { createDownloadToken } from "./tokens.ts";
import { getProductById } from "../data/products.ts";
import { sendEmail, receiptEmailHtml } from "../services/email.ts";
import { markPaidAndGrant, setOrderEmailIfEmpty, type OrderRecord } from "./orders.ts";
// siteUrl comes from lib/server.ts, which imports next/headers — it is
// loaded lazily inside fulfilPaypalOrder so this module stays
// importable in plain node contexts (the unit tests pin the pure
// buildPaypalOrderBody without a Next runtime).

export function paypalBase(): string {
  return process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/** The PUBLIC client id — safe to render into the checkout page for the JS SDK. */
export function paypalClientId(): string | null {
  return process.env.PAYPAL_CLIENT_ID || null;
}

export async function getPaypalAccessToken(): Promise<string | null> {
  if (!paypalConfigured()) return null;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  try {
    const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export interface PaypalOrderBodyInput {
  /** Store order id (AST-…). */
  orderId: string;
  /** Fulfilment product ids, in order. */
  productIds: string[];
  totalUSD: number;
  /** Buyer-typed checkout email when provided; omitted entirely when absent. */
  email?: string | null;
  returnUrl: string;
  cancelUrl: string;
}

/**
 * The exact Orders v2 create body — shared by the redirect flow and
 * the JS SDK flow so both produce identical PayPal orders. Pure:
 * pinned by tests.
 */
export function buildPaypalOrderBody(input: PaypalOrderBodyInput) {
  return {
    intent: "CAPTURE" as const,
    purchase_units: [
      {
        reference_id: input.orderId,
        custom_id: input.productIds.join(","),
        amount: { currency_code: "USD", value: input.totalUSD.toFixed(2) },
        description: "Astralium Digitale Store order",
      },
    ],
    ...(input.email ? { payer: { email_address: input.email } } : {}),
    application_context: {
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      user_action: "PAY_NOW" as const,
    },
  };
}

export async function createPaypalOrder(
  token: string,
  body: ReturnType<typeof buildPaypalOrderBody>,
): Promise<{ id: string; approveUrl: string | null } | null> {
  try {
    const res = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; links?: { rel: string; href: string }[] };
    if (!res.ok || !data.id) return null;
    return { id: data.id, approveUrl: data.links?.find((l) => l.rel === "approve")?.href ?? null };
  } catch {
    return null;
  }
}

export interface PaypalCaptureResult {
  ok: boolean;
  /** PayPal order status after capture (COMPLETED expected). */
  status: string | null;
  captureId: string | null;
  captureStatus: string | null;
  /** Payer email returned by PayPal with the capture (when present). */
  payerEmail: string | null;
}

export async function capturePaypalOrder(token: string, providerOrderId: string): Promise<PaypalCaptureResult> {
  try {
    const res = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      payer?: { email_address?: string };
      purchase_units?: { payments?: { captures?: { id?: string; status?: string }[] } }[];
    };
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    return {
      ok: res.ok && capture?.status === "COMPLETED",
      status: data.status ?? null,
      captureId: capture?.id ?? null,
      captureStatus: capture?.status ?? null,
      payerEmail: data.payer?.email_address ?? null,
    };
  } catch {
    return { ok: false, status: null, captureId: null, captureStatus: null, payerEmail: null };
  }
}

/** Webhook signature verification — unchanged semantics, shared home. */
export async function verifyPaypalWebhookEvent(headers: Headers, rawEvent: unknown, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: rawEvent,
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { verification_status?: string };
    return data.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/**
 * Fulfil a captured PayPal order through the ledger. Moved verbatim
 * from the webhook (2026-11) and extended with the payer-email fill:
 * when the buyer skipped the optional checkout email, the payer
 * email from the capture is stored first, so the receipt below and
 * the delivery records use it. Idempotent — a duplicate fulfilment
 * is a ledger no-op.
 */
export async function fulfilPaypalOrder(
  order: OrderRecord,
  captureId: string | null,
  opts: { payerEmail?: string | null; via?: string } = {},
): Promise<void> {
  const via = opts.via ?? "paypal-webhook";
  let effective = order;
  if (opts.payerEmail && !order.email) {
    const filled = await setOrderEmailIfEmpty(order.id, opts.payerEmail).catch(() => null);
    if (filled) effective = filled;
  }
  const ledger = await markPaidAndGrant({
    providerRef: effective.providerRef,
    provider: "paypal",
    orderId: effective.id,
    email: effective.email,
    items: effective.items,
    totalUSD: effective.totalUSD,
    currency: effective.currency,
    deliveryChannel: effective.deliveryChannel,
    deliverySubjectHash: effective.deliverySubjectHash,
  });
  if (!ledger.ok) {
    console.log(JSON.stringify({ event: "order.paid-refused", orderId: effective.id, reason: ledger.reason, via }));
    return;
  }
  if (ledger.duplicate) return;
  const { siteUrl } = await import("./server.ts");
  const grantTokens = new Map(ledger.grants.map((g) => [g.productId, g.token]));
  const links = effective.items
    .map((item) => getProductById(item.productId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      title: p.title,
      downloadUrl: `${siteUrl()}/api/download/${grantTokens.get(p.id) ?? createDownloadToken(p.id, effective.id)}`,
    }));
  console.log(JSON.stringify({ event: "order.fulfilled", orderId: effective.id, via, captureId }));
  if (effective.email && links.length > 0) {
    await sendEmail({
      to: effective.email,
      subject: `Your Astralium order ${effective.id} — download links inside`,
      kind: "receipt",
      orderId: effective.id,
      html: receiptEmailHtml({
        brand: "Astralium Digitale Store",
        orderId: effective.id,
        items: links,
        totalFormatted: `$${effective.totalUSD.toFixed(2)}`,
      }),
    });
  }
  const { recordOwnerEvent } = await import("./owner-alerts.ts");
  void recordOwnerEvent({
    kind: "order_paid",
    title: `New paid order ${effective.id} — $${effective.totalUSD.toFixed(2)}`,
    detail: { orderId: effective.id, totalUSD: effective.totalUSD, items: effective.items.length, via: "paypal" },
  });
}
