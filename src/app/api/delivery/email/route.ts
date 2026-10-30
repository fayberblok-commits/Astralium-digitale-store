import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSession } from "../../../../lib/fulfill";
import { deliverOrder } from "../../../../services/delivery";

export const runtime = "nodejs";

/**
 * "Email it to me" from the success page. The Stripe session is verified
 * server-side first (same rule as the success page itself — downloads are
 * never issued from client claims), then the receipt is (re)sent through
 * the delivery orchestrator's email channel, which records the attempt.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { sessionId?: string } | null;
  if (!body?.sessionId) {
    return NextResponse.json({ error: "SESSION_REQUIRED" }, { status: 400 });
  }
  const verified = await verifyStripeSession(body.sessionId);
  if (!verified) {
    return NextResponse.json({ error: "PAYMENT_NOT_VERIFIED" }, { status: 402 });
  }
  const outcome = await deliverOrder(
    { orderId: verified.orderId, email: verified.email, productIds: verified.productIds },
    "email",
  );
  return NextResponse.json({ ok: outcome.deliveredVia === "email", deliveredVia: outcome.deliveredVia });
}
