import { NextRequest, NextResponse } from "next/server";
import { getOrderByRef } from "../../../../lib/orders";
import { capturePaypalOrder, fulfilPaypalOrder, getPaypalAccessToken, paypalConfigured } from "../../../../lib/paypal";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";

export const runtime = "nodejs";

/**
 * Capture endpoint for the on-page PayPal JS SDK flow (owner fix,
 * 2026-11). The SDK's Buttons / Card Fields approve an order IN the
 * store; this endpoint performs the actual capture server-side and
 * fulfils through the SAME ledger path as the webhook
 * (lib/paypal.ts fulfilPaypalOrder — PAID only from PENDING).
 *
 * Safety properties:
 *  - the PayPal order id must already exist in our ledger as a
 *    PENDING PayPal order (created by POST /api/checkout mode:"sdk")
 *    — a foreign or invented id captures nothing;
 *  - money moves only via PayPal's capture call; fulfilment only on
 *    a COMPLETED capture;
 *  - idempotent: an already-paid order returns success without a
 *    second capture (the webhook may race us — the ledger dedupes);
 *  - when the buyer skipped the optional checkout email, the payer
 *    email from the capture is stored on the order for the receipt
 *    and delivery records (fill-only).
 *
 * The redirect checkout flow never calls this route and is unchanged.
 */
const PROVIDER_ORDER_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export async function POST(req: NextRequest) {
  const ipCheck = rateLimiters.publicPostIp.check(`ip:${getClientIp(req)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  if (!paypalConfigured()) {
    return NextResponse.json({ error: "PAYMENTS_NOT_CONFIGURED" }, { status: 503 });
  }
  let body: { providerOrderId?: string } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 4 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const providerOrderId = typeof body?.providerOrderId === "string" ? body.providerOrderId : "";
  if (!PROVIDER_ORDER_ID_RE.test(providerOrderId)) {
    return NextResponse.json({ error: "BAD_PROVIDER_ORDER_ID" }, { status: 400 });
  }

  const order = await getOrderByRef(providerOrderId);
  if (!order || order.provider !== "paypal") {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  const successUrl = `/${order.locale}/success?po=${encodeURIComponent(providerOrderId)}`;
  if (order.status === "paid" || order.status === "fulfilled") {
    return NextResponse.json({ ok: true, alreadyPaid: true, orderId: order.id, successUrl });
  }
  if (order.status !== "pending") {
    return NextResponse.json({ error: "ORDER_NOT_PAYABLE", status: order.status }, { status: 409 });
  }

  const token = await getPaypalAccessToken();
  if (!token) {
    return NextResponse.json({ error: "PAYPAL_AUTH_FAILED" }, { status: 502 });
  }
  const cap = await capturePaypalOrder(token, providerOrderId);
  if (!cap.ok) {
    console.log(JSON.stringify({ event: "paypal.sdk-capture-incomplete", orderId: order.id, status: cap.status ?? null, captureStatus: cap.captureStatus ?? null }));
    // A PENDING capture (PayPal risk/eCheck review — common on new
    // merchant accounts) is not a failure and not a success: the money
    // completes on PayPal's side and the CAPTURE.COMPLETED webhook
    // fulfils then. Answer with the distinct pending state (plus the
    // success URL, whose page polls) instead of a dead-end 402 that no
    // retry could ever turn into success.
    if (cap.captureStatus === "PENDING") {
      return NextResponse.json(
        { ok: false, pending: true, error: "CAPTURE_PENDING", status: cap.captureStatus, successUrl },
        { status: 202 },
      );
    }
    return NextResponse.json({ error: "CAPTURE_NOT_COMPLETED", status: cap.captureStatus ?? cap.status }, { status: 402 });
  }
  // The capture COMPLETED — money has moved. Fulfilment trouble from
  // here must never surface as a bare 500 (the buyer would read it as
  // "not charged" and might pay again): log it and answer with the
  // order's real paid state; the client shows the honest
  // "payment being confirmed" state with the success-page link.
  try {
    await fulfilPaypalOrder(order, cap.captureId, { payerEmail: cap.payerEmail, via: "paypal-sdk" });
  } catch (err) {
    console.log(JSON.stringify({ event: "paypal.sdk-fulfil-failed", orderId: order.id, error: String(err) }));
  }
  const after = await getOrderByRef(providerOrderId).catch(() => null);
  return NextResponse.json({
    ok: true,
    orderId: order.id,
    paid: after ? after.status === "paid" || after.status === "fulfilled" : false,
    successUrl,
  });
}
