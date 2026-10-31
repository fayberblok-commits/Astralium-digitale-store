import { STRIPE_API_VERSION } from "../../../lib/stripe";
import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { getOfferConfig, buildUpsellCheckoutParams } from "../../../lib/offers";
import { getProductById } from "../../../data/products";
import { siteUrl } from "../../../lib/server";
import { httpErrorResponse, readJsonBody } from "../../../lib/http";

export const runtime = "nodejs";

/**
 * One-click post-purchase upsell (Phase 3, feature 4). Creates a NEW
 * Stripe checkout session for the upsell product at the configured
 * discount — it NEVER charges the original payment method directly;
 * the customer confirms on Stripe's page like any checkout.
 * Flag-gated (403 when off) and honest 503 when Stripe is not set.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("order_bump"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  let body: {
    productId?: string; // the PURCHASED product whose config defines the upsell
    email?: string;
    orderId?: string;
    locale?: string;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.productId || !body.email || !body.orderId) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const config = await getOfferConfig();
  const slot = config[body.productId]?.upsell;
  if (!slot) {
    return NextResponse.json({ error: "NO_UPSELL_CONFIGURED" }, { status: 404 });
  }
  const product = getProductById(slot.productId);
  if (!product) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "PAYMENTS_NOT_CONFIGURED" }, { status: 503 });
  }
  const form = buildUpsellCheckoutParams({
    product,
    discountPercent: slot.discountPercent,
    email: body.email,
    orderId: body.orderId.slice(0, 40),
    base: siteUrl(),
    locale: body.locale && body.locale.length <= 10 ? body.locale : "en",
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_API_VERSION, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const session = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) {
    return NextResponse.json({ error: session.error?.message ?? "STRIPE_ERROR" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url, sessionId: session.id });
}
