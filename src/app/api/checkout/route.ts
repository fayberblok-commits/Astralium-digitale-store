import { NextRequest, NextResponse } from "next/server";
import { getProductById, getBundleById } from "../../../data/products";
import { applyCoupon } from "../../../lib/coupons";
import { siteUrl } from "../../../lib/server";

export const runtime = "nodejs";

interface CartRef { id: string; kind?: string }

const REQUIRED_ENV = [
  "STRIPE_SECRET_KEY (Stripe) — dashboard.stripe.com/apikeys",
  "or PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (PayPal) — developer.paypal.com",
];

/**
 * Creates a REAL payment session with the configured provider.
 * Prices always come from the server-side catalog — client prices are
 * ignored. Without any provider configured this returns 503
 * PAYMENTS_NOT_CONFIGURED. It never fabricates a payment.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    items?: CartRef[];
    email?: string;
    provider?: string;
    coupon?: string;
    locale?: string;
    orderId?: string;
  } | null;
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "EMPTY_CART" }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  const locale = body.locale && body.locale.length <= 10 ? body.locale : "en";
  const orderId = (body.orderId ?? `AST-${Date.now().toString(36).toUpperCase()}`).slice(0, 40);

  // Resolve items server-side (client prices are never trusted). Bundles
  // stay a single line at the bundle price; their products are recorded
  // for fulfilment.
  const productIds: string[] = [];
  const lineItems: { title: string; amountUSD: number }[] = [];
  let subtotal = 0;
  for (const ref of body.items) {
    const product = getProductById(ref.id);
    if (product) {
      productIds.push(product.id);
      lineItems.push({ title: product.title, amountUSD: product.priceUSD });
      subtotal += product.priceUSD;
      continue;
    }
    const bundle = getBundleById(ref.id);
    if (bundle) {
      productIds.push(...bundle.productIds);
      lineItems.push({ title: bundle.title, amountUSD: bundle.priceUSD });
      subtotal += bundle.priceUSD;
      continue;
    }
    return NextResponse.json({ error: `UNKNOWN_ITEM:${ref.id}` }, { status: 400 });
  }

  // Coupon (server-side re-validation; country from CF header when present).
  let discount = 0;
  if (body.coupon) {
    const country = req.headers.get("cf-ipcountry") ?? undefined;
    const result = applyCoupon(body.coupon, subtotal, { isFirstOrder: true, country });
    if (result.ok) discount = result.discountUSD;
  }
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  const provider = body.provider === "paypal" ? "paypal" : "stripe";
  const base = siteUrl();

  if (provider === "stripe" && process.env.STRIPE_SECRET_KEY) {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("customer_email", email);
    form.set("client_reference_id", orderId);
    form.set("success_url", `${base}/${locale}/success?session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${base}/${locale}/checkout`);
    form.set("metadata[order_id]", orderId);
    form.set("metadata[product_ids]", productIds.join(","));
    form.set("payment_method_types[0]", "card");
    form.set("payment_method_types[1]", "link");
    // One aggregated line keeps Stripe Tax/coupons simple in this release;
    // per-item lines carry the real catalog titles for the receipt.
    let idx = 0;
    for (const line of lineItems) {
      form.set(`line_items[${idx}][quantity]`, "1");
      form.set(`line_items[${idx}][price_data][currency]`, "usd");
      form.set(`line_items[${idx}][price_data][unit_amount]`, String(Math.round(line.amountUSD * 100)));
      form.set(`line_items[${idx}][price_data][product_data][name]`, line.title);
      idx++;
    }
    if (discount > 0) {
      // Apply the coupon as a negative adjustment line is not supported;
      // instead reduce via a one-off Stripe coupon created on the fly.
      const couponForm = new URLSearchParams();
      couponForm.set("amount_off", String(Math.round(discount * 100)));
      couponForm.set("currency", "usd");
      couponForm.set("duration", "once");
      couponForm.set("name", `Astralium ${body.coupon ?? "discount"}`);
      const cRes = await fetch("https://api.stripe.com/v1/coupons", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: couponForm,
      });
      if (cRes.ok) {
        const c = (await cRes.json()) as { id: string };
        form.set("discounts[0][coupon]", c.id);
      }
    }
    void total;
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const session = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !session.url) {
      return NextResponse.json({ error: session.error?.message ?? "STRIPE_ERROR" }, { status: 502 });
    }
    return NextResponse.json({ url: session.url, sessionId: session.id, orderId });
  }

  if (provider === "paypal" && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    const paypalBase = process.env.PAYPAL_ENV === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch(`${paypalBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!tokenRes.ok) return NextResponse.json({ error: "PAYPAL_AUTH_FAILED" }, { status: 502 });
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    const orderRes = await fetch(`${paypalBase}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: orderId,
            custom_id: productIds.join(","),
            amount: { currency_code: "USD", value: total.toFixed(2) },
            description: "Astralium Digitale Store order",
          },
        ],
        payer: { email_address: email },
        application_context: {
          return_url: `${base}/${locale}/success?order=${orderId}`,
          cancel_url: `${base}/${locale}/checkout`,
          user_action: "PAY_NOW",
        },
      }),
    });
    const order = (await orderRes.json()) as { id?: string; links?: { rel: string; href: string }[] };
    const approve = order.links?.find((l) => l.rel === "approve")?.href;
    if (!orderRes.ok || !approve) {
      return NextResponse.json({ error: "PAYPAL_ORDER_FAILED" }, { status: 502 });
    }
    return NextResponse.json({ url: approve, providerOrderId: order.id, orderId });
  }

  return NextResponse.json(
    { error: "PAYMENTS_NOT_CONFIGURED", requiredEnv: REQUIRED_ENV },
    { status: 503 },
  );
}
