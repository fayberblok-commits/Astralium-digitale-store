import { NextRequest, NextResponse } from "next/server";
// Phase 1 upgrade (F1 + §8): real signature verification (the previous
// skeleton recorded events WITHOUT verifying them), capture on approve,
// ledger transitions for fulfilment/refund/dispute. The PayPal calls
// and fulfilment live in lib/paypal.ts (2026-11), shared with the
// redirect checkout and the on-page JS SDK capture endpoint so the
// money logic exists exactly once.
import { applyDispute, applyRefund, getOrderByRef } from "../../../../lib/orders";
import { capturePaypalOrder, fulfilPaypalOrder, getPaypalAccessToken, verifyPaypalWebhookEvent } from "../../../../lib/paypal";
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
 */
const processed = new Set<string>();

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

  const token = await getPaypalAccessToken();
  if (!token || !(await verifyPaypalWebhookEvent(req.headers, event, token))) {
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
    const cap = await capturePaypalOrder(token, paypalOrderId);
    if (cap.ok) {
      await fulfilPaypalOrder(order, cap.captureId, { payerEmail: cap.payerEmail });
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
