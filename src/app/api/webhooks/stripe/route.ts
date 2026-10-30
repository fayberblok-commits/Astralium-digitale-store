import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createDownloadToken } from "../../../../lib/tokens";
import { findSubjectByHash } from "../../../../lib/pii";
import { deliverOrder } from "../../../../services/delivery";
import { sendEmail, receiptEmailHtml } from "../../../../services/email";
import { getProductById } from "../../../../data/products";
import { siteUrl } from "../../../../lib/server";
// Phase 4 (features 10, 11, 12, 15, 16)
import { getFlag } from "../../../../lib/flags";
import { listGifts, processPaidOrderGifts } from "../../../../lib/gifts";
import { earnForOrder } from "../../../../lib/loyalty";
import { markAttributionEarned } from "../../../../lib/referrals";
import { processSubscriptionEvent, type SubscriptionEvent } from "../../../../lib/subscriptions";
import { receiptDataFor, receiptPdfBase64 } from "../../../../lib/receipt";
// Phase 5 (features 18, 19): fraud holds pause fulfilment; license keys
// are issued on delivery for configured products.
import { isOrderHeld } from "../../../../lib/fraud";
import { issueLicenseKeysForOrder, licenseKeysEmailHtml, type IssuedKey } from "../../../../lib/license";

export const runtime = "nodejs";

/**
 * Stripe webhook — manual signature verification (HMAC-SHA256 over
 * `${timestamp}.${rawBody}`), 5-minute timestamp tolerance, idempotent by
 * event id. On checkout.session.completed: build the order record, mint
 * signed download tokens, email the receipt (or log it), return 200.
 * Late webhooks still fulfil — fulfilment reads only the event payload.
 */
const processed = new Set<string>();

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
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

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  }
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "BAD_SIGNATURE" }, { status: 400 });
  }
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }
  if (!event.id || processed.has(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  processed.add(event.id);

  // Phase 4, feature 15: subscription lifecycle (Stripe Billing). The
  // reducer in lib/subscriptions.ts is replay-safe beyond this in-memory
  // event set (per-cycle grant marker), and dunning state is recorded —
  // reminder emails are sent by the /api/jobs/dunning cron, not here.
  const isSubscriptionEvent =
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed" ||
    event.type === "customer.subscription.deleted" ||
    (event.type === "checkout.session.completed" &&
      ((event.data?.object?.["metadata"] as Record<string, string> | undefined)?.kind === "subscription"));
  if (isSubscriptionEvent && (await getFlag("subscriptions"))) {
    const obj = event.data?.object ?? {};
    let subEvent: SubscriptionEvent | null = null;
    if (event.type === "checkout.session.completed") {
      const metadata = (obj["metadata"] ?? {}) as Record<string, string>;
      const email = ((obj["customer_details"] as { email?: string } | undefined)?.email ?? "").toString();
      if (obj["subscription"] && email && metadata.product_id) {
        subEvent = {
          type: "checkout_completed",
          stripeSubscriptionId: String(obj["subscription"]),
          stripeCustomerId: obj["customer"] ? String(obj["customer"]) : null,
          email,
          productId: metadata.product_id,
        };
      }
    } else if (event.type === "invoice.paid") {
      const lines = (obj["lines"] as { data?: { period?: { end?: number } }[] } | undefined)?.data;
      const periodEnd = lines?.[0]?.period?.end;
      if (obj["subscription"] && periodEnd) {
        subEvent = {
          type: "invoice_paid",
          stripeSubscriptionId: String(obj["subscription"]),
          periodEndISO: new Date(periodEnd * 1000).toISOString(),
        };
      }
    } else if (event.type === "invoice.payment_failed") {
      if (obj["subscription"]) {
        subEvent = {
          type: "invoice_payment_failed",
          stripeSubscriptionId: String(obj["subscription"]),
          atISO: new Date().toISOString(),
        };
      }
    } else if (event.type === "customer.subscription.deleted") {
      subEvent = { type: "subscription_deleted", stripeSubscriptionId: String(obj["id"] ?? "") };
    }
    if (subEvent) {
      const summary = await processSubscriptionEvent(subEvent);
      console.log(JSON.stringify({ event: "subscription.webhook", type: event.type, ...summary }));
    }
    return NextResponse.json({ received: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const metadata = (session["metadata"] ?? {}) as Record<string, string>;
    const orderId = metadata.order_id || String(session["client_reference_id"] ?? event.id);
    const email = ((session["customer_details"] as { email?: string } | undefined)?.email ?? "").toString();
    const productIds = (metadata.product_ids ?? "").split(",").filter(Boolean);
    // Phase 5, feature 19: a HELD order (fraud shield) is paid but NOT
    // fulfilled — no gifts, no links, no license keys, no loyalty earn —
    // until the owner releases the hold in admin (the release re-issues
    // delivery). Returning 200 stops Stripe retries; the hold is the
    // durable record, and the buyer-facing download route also refuses.
    if ((await getFlag("fraud_shield")) && (await isOrderHeld(orderId))) {
      console.log(JSON.stringify({ event: "order.held", orderId, via: "stripe-webhook" }));
      return NextResponse.json({ received: true, held: true });
    }
    // Phase 4, feature 10: gift items are delivered to their RECIPIENTS
    // (processPaidOrderGifts, incl. the buyer's link-free confirmation) —
    // they are removed from every buyer-facing delivery below.
    let giftProductIds = new Set<string>();
    if (productIds.length > 0 && (await getFlag("gifts"))) {
      const orderGifts = await listGifts({ orderId });
      giftProductIds = new Set(orderGifts.map((g) => g.productId));
      if (orderGifts.length > 0) {
        const summary = await processPaidOrderGifts(orderId);
        console.log(JSON.stringify({ event: "order.gifts-processed", orderId, ...summary }));
      }
    }
    const buyerProductIds = productIds.filter((pid) => !giftProductIds.has(pid));
    const links = buyerProductIds
      .map((pid) => getProductById(pid))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        title: p.title,
        downloadUrl: `${siteUrl()}/api/download/${createDownloadToken(p.id, orderId)}`,
      }));
    // Phase 4, features 11+12: loyalty earn on the completed order and
    // the referral flip to "earned" — both idempotent per order, so a
    // webhook retry can never double-apply either.
    const amountTotalUSD = typeof session["amount_total"] === "number" ? session["amount_total"] / 100 : 0;
    if (email && amountTotalUSD > 0 && (await getFlag("loyalty"))) {
      const earned = await earnForOrder(email, orderId, amountTotalUSD);
      console.log(JSON.stringify({ event: "loyalty.earn", orderId, ...earned }));
    }
    await markAttributionEarned(orderId);
    console.log(JSON.stringify({ event: "order.fulfilled", orderId, email, productIds, via: "stripe-webhook", eventId: event.id }));
    // Phase 6, feature 26: a newly paid order notifies the owner center.
    {
      const { recordOwnerEvent } = await import("../../../../lib/owner-alerts");
      void recordOwnerEvent({
        kind: "order_paid",
        title: `New paid order ${orderId} — $${amountTotalUSD.toFixed(2)}`,
        detail: { orderId, totalUSD: amountTotalUSD, items: productIds.length, via: "stripe" },
      });
    }
    // Phase 2: proactive WhatsApp delivery when the customer chose it at
    // checkout and opted in. Stripe metadata carries only the subject
    // HASH; the phone is recovered from its encrypted consent record.
    // deliverOrder owns the flow incl. automatic email fallback, so the
    // plain receipt email below is skipped in that case (no duplicates).
    const deliveryChannel = metadata.delivery_channel;
    let socialHandled = false;
    if (deliveryChannel === "whatsapp" && metadata.delivery_subject_hash && buyerProductIds.length > 0) {
      const phone = await findSubjectByHash(metadata.delivery_subject_hash, "whatsapp");
      if (phone) {
        const outcome = await deliverOrder(
          { orderId, email: email || null, phoneE164: phone, productIds: buyerProductIds },
          "whatsapp",
        );
        socialHandled = true;
        console.log(JSON.stringify({ event: "order.social-delivery", orderId, deliveredVia: outcome.deliveredVia, fellBack: outcome.fellBack }));
      }
    }
    // Phase 5, feature 18: license keys for configured products are
    // issued on delivery (idempotent per order+product; plaintext exists
    // only here, for the buyer's email — storage keeps hash + last-4).
    let issuedKeys: IssuedKey[] = [];
    if (email && buyerProductIds.length > 0 && (await getFlag("license_keys"))) {
      issuedKeys = await issueLicenseKeysForOrder(orderId, email, buyerProductIds);
      if (issuedKeys.length > 0) {
        console.log(JSON.stringify({ event: "license.issued", orderId, products: issuedKeys.map((k) => k.productId) }));
      }
    }
    if (!socialHandled && email && links.length > 0) {
      const total = buyerProductIds.reduce((s, pid) => s + (getProductById(pid)?.priceUSD ?? 0), 0);
      // Phase 4, feature 16: PDF receipt attached when the receipts
      // flag is on. The receipt covers the buyer's own items (gift
      // items are the recipients' documents, not the buyer's).
      const attachments = (await getFlag("receipts"))
        ? [{
            filename: `astralium-receipt-${orderId}.pdf`,
            contentBase64: receiptPdfBase64(receiptDataFor({
              orderId,
              email,
              items: buyerProductIds
                .map((pid) => getProductById(pid))
                .filter((p): p is NonNullable<typeof p> => Boolean(p))
                .map((p) => ({ title: p.title, priceUSD: p.priceUSD })),
              totalUSD: amountTotalUSD > 0 ? amountTotalUSD : total,
            })),
          }]
        : undefined;
      await sendEmail({
        to: email,
        subject: `Your Astralium order ${orderId} — download links inside`,
        kind: "receipt",
        orderId,
        html: receiptEmailHtml({ brand: "Astralium Digitale Store", orderId, items: links, totalFormatted: `$${total.toFixed(2)}` }) + licenseKeysEmailHtml(issuedKeys),
        attachments,
      });
    } else if (socialHandled && email && issuedKeys.length > 0) {
      // Delivered via WhatsApp above: keys still travel by email — they
      // are documents the buyer must be able to keep and re-read.
      await sendEmail({
        to: email,
        subject: `Your Astralium license keys — order ${orderId}`,
        kind: "receipt",
        orderId,
        html: licenseKeysEmailHtml(issuedKeys),
      });
    }
  }

  return NextResponse.json({ received: true });
}
