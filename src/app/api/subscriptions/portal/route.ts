import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { siteUrl } from "../../../../lib/server";
import { buildPortalParams, findSubscriptionByEmail } from "../../../../lib/subscriptions";

export const runtime = "nodejs";

/**
 * Stripe Billing Portal session (Phase 4, feature 15): the customer
 * manages/cancels their subscription on Stripe's hosted portal. Needs a
 * recorded subscription with a Stripe customer id; without Stripe keys
 * it returns an honest 503.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("subscriptions"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json({ error: "PAYMENTS_NOT_CONFIGURED" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as { email?: string; locale?: string } | null;
  const email = (body?.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  const subscription = await findSubscriptionByEmail(email);
  if (!subscription?.stripeCustomerId) {
    return NextResponse.json({ error: "NO_SUBSCRIPTION" }, { status: 404 });
  }
  const locale = body?.locale && body.locale.length <= 10 ? body.locale : "en";
  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: buildPortalParams({ customerId: subscription.stripeCustomerId, base: siteUrl(), locale }),
  });
  const session = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) {
    return NextResponse.json({ error: session.error?.message ?? "STRIPE_ERROR" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
