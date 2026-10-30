import { NextRequest, NextResponse } from "next/server";
import { getProductById } from "../../../../data/products";
import { getFlag } from "../../../../lib/flags";
import { siteUrl } from "../../../../lib/server";
import {
  buildSubscriptionCheckoutParams, getPlanConfig, subscriptionsDbAvailable,
} from "../../../../lib/subscriptions";

export const runtime = "nodejs";

/**
 * Start a subscription (Phase 4, feature 15) — Stripe Billing.
 *
 * Honest gating, in order: flag off → 403; no database → 503
 * SUBSCRIPTIONS_REQUIRE_DATABASE (subscription state must be durable);
 * no Stripe key → 503 PAYMENTS_NOT_CONFIGURED; no plan for the product
 * → 404. The price comes from the server-side plan config, never the
 * client. Access is granted by the invoice.paid webhook, not here.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("subscriptions"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  if (!(await subscriptionsDbAvailable())) {
    return NextResponse.json({ error: "SUBSCRIPTIONS_REQUIRE_DATABASE" }, { status: 503 });
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "PAYMENTS_NOT_CONFIGURED", requiredEnv: ["STRIPE_SECRET_KEY (Stripe) — dashboard.stripe.com/apikeys"] },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => null)) as { productId?: string; email?: string; locale?: string } | null;
  const email = (body?.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  const product = body?.productId ? getProductById(body.productId) : undefined;
  if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  const plans = await getPlanConfig();
  const plan = plans[product.id];
  if (!plan) return NextResponse.json({ error: "NO_SUBSCRIPTION_PLAN" }, { status: 404 });
  const locale = body?.locale && body.locale.length <= 10 ? body.locale : "en";

  const form = buildSubscriptionCheckoutParams({
    productId: product.id, plan, productTitle: product.title, email, base: siteUrl(), locale,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const session = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) {
    return NextResponse.json({ error: session.error?.message ?? "STRIPE_ERROR" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url, sessionId: session.id });
}
