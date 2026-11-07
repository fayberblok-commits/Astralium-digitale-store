import { NextRequest, NextResponse } from "next/server";
// Phase 1 upgrade (F1 + §8): real signature verification (the previous
// skeleton recorded events WITHOUT verifying them), capture on approve,
// ledger transitions for fulfilment/refund/dispute. The PayPal calls
// and fulfilment live in lib/paypal.ts (2026-11), shared with the
// redirect checkout and the on-page JS SDK capture endpoint so the
// money logic exists exactly once.
import { applyDispute, applyRefund, createPendingOrder, getOrderByRef, type OrderRecord } from "../../../../lib/orders";
import { capturePaypalOrder, fulfilPaypalOrder, getPaypalAccessToken, getPaypalOrder, verifyPaypalWebhookEvent } from "../../../../lib/paypal";
import { getStorefrontProducts } from "../../../../lib/catalog";
import { recordSecurityEvent } from "../../../../lib/security-log";
import { recordOwnerEvent } from "../../../../lib/owner-alerts";

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

/**
 * Ledger reconstruction (defence in depth): an approved PayPal order
 * whose PENDING ledger row is missing must never be answered with a
 * silent 200 — money would sit approved, uncaptured, invisible. The
 * ledger row is rebuilt from PayPal's own verified order data
 * (reference_id = our order id, custom_id = the product ids, amount =
 * the order total), priced from the real catalog. Returns null when
 * the order cannot be trusted/rebuilt (caller then answers 5xx so
 * PayPal keeps retrying and the owner alert below has fired).
 */
async function ensureLedgerOrder(token: string, paypalOrderId: string): Promise<OrderRecord | null> {
  const existing = await getOrderByRef(paypalOrderId);
  if (existing) return existing;
  const details = await getPaypalOrder(token, paypalOrderId);
  if (!details?.referenceId || !details.customId || details.amountUSD === null) return null;
  const ids = details.customId.split(",").map((s) => s.trim()).filter(Boolean);
  // custom_id carries the ORDER id (not product ids) when the id list
  // exceeded PayPal's 127-char cap — items are then unknowable here.
  if (ids.length === 1 && ids[0] === details.referenceId) return null;
  const catalog = await getStorefrontProducts().catch(() => []);
  const byId = new Map(catalog.map((p) => [p.id, p]));
  if (ids.some((id) => !byId.has(id))) return null;
  const items = ids.map((id) => ({ productId: id, priceUSD: byId.get(id)?.priceUSD ?? 0 }));
  const priced = Math.round(items.reduce((s, i) => s + i.priceUSD, 0) * 100) / 100;
  if (Math.abs(priced - details.amountUSD) > 0.01) return null;
  const order = await createPendingOrder({
    orderId: details.referenceId,
    email: details.payerEmail ?? "",
    provider: "paypal",
    providerRef: paypalOrderId,
    items,
    totalUSD: details.amountUSD,
    currency: "USD",
    deliveryChannel: "email",
    deliverySubjectHash: null,
    country: null,
    locale: "en",
  });
  console.log(JSON.stringify({ event: "paypal.ledger-reconstructed", orderId: order.id, paypalOrderId }));
  return order;
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
  // Dedupe AFTER signature verification and only once handling has
  // SUCCEEDED: marking an event processed on first sight used to
  // swallow PayPal's retries after a bad-signature delivery, a failed
  // capture, or a mid-fulfilment throw — permanently, per instance.
  if (event.id && processed.has(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
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
    const order = paypalOrderId ? await ensureLedgerOrder(token, paypalOrderId) : null;
    if (!order) {
      // Approved money we cannot account for: alert the owner and
      // answer 5xx so PayPal keeps retrying — never a silent 200.
      console.log(JSON.stringify({ event: "paypal.approved-not-in-ledger", paypalOrderId }));
      void recordOwnerEvent({
        kind: "security_alert",
        title: `PayPal approved order ${paypalOrderId} is not in the ledger`,
        detail: { paypalOrderId, eventType: type },
      }).catch(() => undefined);
      return NextResponse.json({ error: "ORDER_NOT_IN_LEDGER" }, { status: 500 });
    }
    // Capture now — approval alone is not payment.
    const cap = await capturePaypalOrder(token, paypalOrderId);
    if (cap.ok) {
      await fulfilPaypalOrder(order, cap.captureId, { payerEmail: cap.payerEmail });
    } else {
      console.log(JSON.stringify({ event: "paypal.capture-incomplete", orderId: order.id, status: cap.status ?? null }));
      // A PENDING capture completes later and re-fires via
      // PAYMENT.CAPTURE.COMPLETED; anything else leaves the order
      // unpaid — retrying this event cannot change it, so the event
      // is still marked processed below.
    }
    if (event.id) processed.add(event.id);
    return NextResponse.json({ received: true });
  }

  if (type === "PAYMENT.CAPTURE.COMPLETED") {
    const paypalOrderId = relatedOrderId(resource);
    const order = paypalOrderId ? await ensureLedgerOrder(token, paypalOrderId) : null;
    if (order) {
      await fulfilPaypalOrder(order, typeof resource["id"] === "string" ? resource["id"] : null);
    } else if (paypalOrderId) {
      console.log(JSON.stringify({ event: "paypal.capture-not-in-ledger", paypalOrderId }));
      void recordOwnerEvent({
        kind: "security_alert",
        title: `PayPal capture completed for unknown order ${paypalOrderId}`,
        detail: { paypalOrderId, eventType: type },
      }).catch(() => undefined);
      return NextResponse.json({ error: "ORDER_NOT_IN_LEDGER" }, { status: 500 });
    }
    if (event.id) processed.add(event.id);
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
    if (event.id) processed.add(event.id);
    return NextResponse.json({ received: true });
  }

  if (type === "CUSTOMER.DISPUTE.CREATED") {
    const paypalOrderId = relatedOrderId(resource);
    if (paypalOrderId) {
      const r = await applyDispute(paypalOrderId);
      console.log(JSON.stringify({ event: "order.dispute-opened", orderRef: paypalOrderId, ok: r.ok, revoked: r.revoked, via: "paypal" }));
      await recordSecurityEvent({ kind: "payment_dispute", actor: "paypal", detail: { orderRef: paypalOrderId, revokedGrants: r.revoked } });
    }
    if (event.id) processed.add(event.id);
    return NextResponse.json({ received: true });
  }

  console.log(JSON.stringify({ event: "paypal.webhook.received", type, id: event.id ?? null, verified: true }));
  if (event.id) processed.add(event.id);
  return NextResponse.json({ received: true, verified: true });
}
