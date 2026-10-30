import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * PayPal webhook skeleton.
 *
 * PayPal verification requires calling /v1/notifications/verify-webhook-signature
 * with the transmission headers + PAYPAL_WEBHOOK_ID. This route enforces
 * that the integration is configured, records events structurally, and is
 * where CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.COMPLETED fulfilment is
 * wired once the merchant enables webhooks in the PayPal dashboard.
 * It never marks anything paid without the verification call succeeding in
 * a production wiring — see docs/LIMITATIONS.md.
 */
const processed = new Set<string>();

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
  const headers = {
    auth_algo: req.headers.get("paypal-auth-algo"),
    cert_url: req.headers.get("paypal-cert-url"),
    transmission_id: req.headers.get("paypal-transmission-id"),
    transmission_sig: req.headers.get("paypal-transmission-sig"),
    transmission_time: req.headers.get("paypal-transmission-time"),
  };
  console.log(JSON.stringify({ event: "paypal.webhook.received", type: event.event_type ?? null, id: event.id ?? null, verificationHeadersPresent: Object.values(headers).every(Boolean) }));
  // Fulfilment note: verify via PayPal API then mirror the Stripe flow
  // (order record + signed download tokens + receipt email).
  return NextResponse.json({ received: true, verified: "pending-merchant-webhook-activation" });
}
