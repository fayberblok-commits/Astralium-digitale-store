import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "../../../../lib/http";
import { getPaypalClientToken, paypalConfigured } from "../../../../lib/paypal";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";

export const runtime = "nodejs";

/**
 * PayPal Card Fields client token (2026-11): the JS SDK only exposes
 * `paypal.CardFields` when loaded with a `data-client-token` minted
 * server-side. The checkout page fetches the token server-side too,
 * but this route exists for any client-side refresh; the token is
 * short-lived, scoped to the merchant account and useless without
 * the public client id, so it is safe to hand to the browser — and
 * never cached. Failures are soft: no token → Smart Buttons only.
 */
export async function GET(req: NextRequest) {
  const ipCheck = rateLimiters.publicPostIp.check(`ip:${getClientIp(req)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  if (!paypalConfigured()) {
    return NextResponse.json({ error: "PAYPAL_NOT_CONFIGURED" }, { status: 503 });
  }
  const clientToken = await getPaypalClientToken();
  if (!clientToken) {
    return NextResponse.json({ error: "CLIENT_TOKEN_UNAVAILABLE" }, { status: 502 });
  }
  return NextResponse.json(
    { clientToken },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
