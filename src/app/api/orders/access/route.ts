import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSession } from "../../../../lib/fulfill";
import { ORDER_ACCESS_COOKIE, ORDER_ACCESS_TTL_SECONDS, orderAccessToken } from "../../../../lib/order-access";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Bind this browser to a verified order (Phase 1 upgrade, §7). Called
 * by the success page after server-side payment verification: exchanges
 * the Stripe session id for a short-lived httpOnly order-access cookie.
 * The receipt endpoint accepts this cookie instead of demanding the
 * session id on every request, and no response here (or there) ever
 * contains the buyer's email.
 */
export async function POST(req: NextRequest) {
  const ipCheck = rateLimiters.receiptIp.check(`ip:${getClientIp(req)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  let body: { sessionId?: string };
  try {
    body = await readJsonBody(req, { maxBytes: 4 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.sessionId) {
    return NextResponse.json({ error: "SESSION_REQUIRED" }, { status: 400 });
  }
  const verified = await verifyStripeSession(body.sessionId);
  if (!verified) {
    return NextResponse.json({ error: "PAYMENT_NOT_VERIFIED" }, { status: 402 });
  }
  const token = orderAccessToken(verified.orderId);
  if (!token) return NextResponse.json({ error: "ACCESS_BINDING_UNAVAILABLE" }, { status: 503 });
  const res = NextResponse.json({ ok: true, orderId: verified.orderId });
  res.cookies.set(ORDER_ACCESS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api",
    maxAge: ORDER_ACCESS_TTL_SECONDS,
  });
  return res;
}
