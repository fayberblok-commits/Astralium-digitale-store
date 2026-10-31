import { NextRequest, NextResponse } from "next/server";
import { createDownloadToken } from "../../../../lib/tokens";
import { getProductById } from "../../../../data/products";
import { siteUrl } from "../../../../lib/server";
import { sendEmail, receiptEmailHtml } from "../../../../services/email";
// Phase 1 upgrade (F1 + §8): real signature verification (the previous
// skeleton recorded events WITHOUT verifying them), capture on approve,
// ledger transitions for fulfilment/refund/dispute.
import { applyDispute, applyRefund, getOrderByRef, markPaidAndGrant, type OrderRecord } from "../../../../lib/orders";
import { recordSecurityEvent } from "../../../../lib/security-log";

export const runtime = "nodejs";

/**
 * PayPal webhook. Every event is verified with PayPal's
 * /v1/notifications/verify-webhook-signature BEFORE anything is acted
 * on; an unverifiable event is rejected (400) and logged to the
 * security log. Handled events:
 *
 *  - CHECKOUT.ORDER.APPROVED → capture the order, then fulfil on the
 *    capture result (the only path to PAID for PayPal — PAID only ever
 *    comes from PENDING, via the ledger).
 *  - PAYMENT.CAPTURE.COMPLETED → fulfil (idempotent; covers captures
 *    triggered outside this handler).
 *  - PAYMENT.CAPTURE.REFUNDED → ledger refund + grant revocation.
 *  - CUSTOMER.DISPUTE.CREATED → ledger dispute hold + grant revocation
 *    + owner alert.
 *
 * Not live-tested: no PayPal merchant account exists yet (owner's
 * "keys after the link" decision) — see the Phase 1 report.
 */
const processed = new Set<string>();

function paypalBase(): string {
  return process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

async function accessToken(): Promise<string | null> {
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

async function verifyEvent(req: NextRequest, rawEvent: unknown, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: req.headers.get("paypal-auth-algo"),
        cert_url: req.headers.get("paypal-cert-url"),
        transmission_id: req.headers.get("paypal-transmission-id"),
        transmission_sig: req.headers.get("paypal-transmission-sig"),
        transmission_time: req.headers.get("paypal-transmission-time"),
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

async function fulfilPaypalOrder(order: OrderRecord, captureId: string | null): Promise<void> {
  const ledger = await markPaidAndGrant({
    providerRef: order.providerRef,
    provider: "paypal",
    orderId: order.id,
    email: order.email,
    items: order.items,
    totalUSD: order.totalUSD,
    currency: order.currency,
    deliveryChannel: order.deliveryChannel,
    deliverySubjectHash: order.deliverySubjectHash,
  });
  if (!ledger.ok) {
    console.log(JSON.stringify({ event: "order.paid-refused", orderId: order.id, reason: ledger.reason, via: "paypal-webhook" }));
    return;
  }
  if (ledger.duplicate) return;
  const grantTokens = new Map(ledger.grants.map((g) => [g.productId, g.token]));
  const links = order.items
    .map((item) => getProductById(item.productId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      title: p.title,
      downloadUrl: `${siteUrl()}/api/download/${grantTokens.get(p.id) ?? createDownloadToken(p.id, order.id)}`,
    }));
  console.log(JSON.stringify({ event: "order.fulfilled", orderId: order.id, via: "paypal-webhook", captureId }));
  if (order.email && links.length > 0) {
    await sendEmail({
      to: order.email,
      subject: `Your Astralium order ${order.id} — download links inside`,
      kind: "receipt",
      orderId: order.id,
      html: receiptEmailHtml({
        brand: "Astralium Digitale Store",
        orderId: order.id,
        items: links,
        totalFormatted: `$${order.totalUSD.toFixed(2)}`,
      }),
    });
  }
  const { recordOwnerEvent } = await import("../../../../lib/owner-alerts");
  void recordOwnerEvent({
    kind: "order_paid",
    title: `New paid order ${order.id} — $${order.totalUSD.toFixed(2)}`,
    detail: { orderId: order.id, totalUSD: order.totalUSD, items: order.items.length, via: "paypal" },
  });
}

function relatedOrderId(resource: Record<string, unknown>): string | null {
  const supplementary = resource["supplementary_data"] as { related_ids?: { order_id?: string } } | undefined;
  if (supplementary?.related_ids?.order_id) return supplementary.related_ids.order_id;
  const custom = resource["custom_id"];
  return typeof custom === "string" && custom ? custom : null;
}

export async function POST(req: NextRequest) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!webhookId || !clientId || !clientSecret) {
    return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED", requiredEnv: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"] }, { status: 503 });
  }
  const raw = await req.text();
  let event: { id?: string; event_type?: string; resource?: Record<string, unknown> } = {};
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  if (event.id) {
    if (processed.has(event.id)) return NextResponse.json({ received: true, duplicate: true });
    processed.add(event.id);
  }

  const token = await accessToken();
  if (!token || !(await verifyEvent(req, event, token))) {
    void recordSecurityEvent({ kind: "webhook_bad_signature", actor: "paypal", detail: { type: event.event_type ?? null } });
    return NextResponse.json({ error: "BAD_SIGNATURE" }, { status: 400 });
  }

  const resource = (event.resource ?? {}) as Record<string, unknown>;
  const type = event.event_type ?? "";

  if (type === "CHECKOUT.ORDER.APPROVED") {
    const paypalOrderId = typeof resource["id"] === "string" ? resource["id"] : "";
    const order = paypalOrderId ? await getOrderByRef(paypalOrderId) : null;
    if (!order) return NextResponse.json({ received: true, note: "order-not-in-ledger" });
    // Capture now — approval alone is not payment.
    const capRes = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const cap = (await capRes.json().catch(() => ({}))) as {
      status?: string;
      purchase_units?: { payments?: { captures?: { id?: string; status?: string }[] } }[];
    };
    const capture = cap.purchase_units?.[0]?.payments?.captures?.[0];
    if (capRes.ok && capture?.status === "COMPLETED") {
      await fulfilPaypalOrder(order, capture.id ?? null);
    } else {
      console.log(JSON.stringify({ event: "paypal.capture-incomplete", orderId: order.id, status: cap.status ?? null }));
    }
    return NextResponse.json({ received: true });
  }

  if (type === "PAYMENT.CAPTURE.COMPLETED") {
    const paypalOrderId = relatedOrderId(resource);
    const order = paypalOrderId ? await getOrderByRef(paypalOrderId) : null;
    if (order) await fulfilPaypalOrder(order, typeof resource["id"] === "string" ? resource["id"] : null);
    return NextResponse.json({ received: true });
  }

  if (type === "PAYMENT.CAPTURE.REFUNDED") {
    const paypalOrderId = relatedOrderId(resource);
    if (paypalOrderId) {
      const r = await applyRefund(paypalOrderId);
      console.log(JSON.stringify({ event: "order.refund-processed", orderRef: paypalOrderId, ok: r.ok, revoked: r.revoked, via: "paypal" }));
      if (r.ok) {
        await recordSecurityEvent({ kind: "order_refunded", actor: "paypal", detail: { orderRef: paypalOrderId, revokedGrants: r.revoked } });
      }
    }
    return NextResponse.json({ received: true });
  }

  if (type === "CUSTOMER.DISPUTE.CREATED") {
    const paypalOrderId = relatedOrderId(resource);
    if (paypalOrderId) {
      const r = await applyDispute(paypalOrderId);
      console.log(JSON.stringify({ event: "order.dispute-opened", orderRef: paypalOrderId, ok: r.ok, revoked: r.revoked, via: "paypal" }));
      await recordSecurityEvent({ kind: "payment_dispute", actor: "paypal", detail: { orderRef: paypalOrderId, revokedGrants: r.revoked } });
    }
    return NextResponse.json({ received: true });
  }

  console.log(JSON.stringify({ event: "paypal.webhook.received", type, id: event.id ?? null, verified: true }));
  return NextResponse.json({ received: true, verified: true });
}
