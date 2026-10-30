import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createDownloadToken } from "../../../../lib/tokens";
import { findSubjectByHash } from "../../../../lib/pii";
import { deliverOrder } from "../../../../services/delivery";
import { sendEmail, receiptEmailHtml } from "../../../../services/email";
import { getProductById } from "../../../../data/products";
import { siteUrl } from "../../../../lib/server";

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

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const metadata = (session["metadata"] ?? {}) as Record<string, string>;
    const orderId = metadata.order_id || String(session["client_reference_id"] ?? event.id);
    const email = ((session["customer_details"] as { email?: string } | undefined)?.email ?? "").toString();
    const productIds = (metadata.product_ids ?? "").split(",").filter(Boolean);
    const links = productIds
      .map((pid) => getProductById(pid))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        title: p.title,
        downloadUrl: `${siteUrl()}/api/download/${createDownloadToken(p.id, orderId)}`,
      }));
    console.log(JSON.stringify({ event: "order.fulfilled", orderId, email, productIds, via: "stripe-webhook", eventId: event.id }));
    // Phase 2: proactive WhatsApp delivery when the customer chose it at
    // checkout and opted in. Stripe metadata carries only the subject
    // HASH; the phone is recovered from its encrypted consent record.
    // deliverOrder owns the flow incl. automatic email fallback, so the
    // plain receipt email below is skipped in that case (no duplicates).
    const deliveryChannel = metadata.delivery_channel;
    let socialHandled = false;
    if (deliveryChannel === "whatsapp" && metadata.delivery_subject_hash && productIds.length > 0) {
      const phone = await findSubjectByHash(metadata.delivery_subject_hash, "whatsapp");
      if (phone) {
        const outcome = await deliverOrder(
          { orderId, email: email || null, phoneE164: phone, productIds },
          "whatsapp",
        );
        socialHandled = true;
        console.log(JSON.stringify({ event: "order.social-delivery", orderId, deliveredVia: outcome.deliveredVia, fellBack: outcome.fellBack }));
      }
    }
    if (!socialHandled && email && links.length > 0) {
      const total = productIds.reduce((s, pid) => s + (getProductById(pid)?.priceUSD ?? 0), 0);
      await sendEmail({
        to: email,
        subject: `Your Astralium order ${orderId} — download links inside`,
        kind: "receipt",
        orderId,
        html: receiptEmailHtml({ brand: "Astralium Digitale Store", orderId, items: links, totalFormatted: `$${total.toFixed(2)}` }),
      });
    }
  }

  return NextResponse.json({ received: true });
}
