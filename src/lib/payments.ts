import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { coupons, orderItems, orders, products, webhookEvents } from "@/db/schema";
import { downloadUrl } from "@/lib/downloads";
import { orderReceiptEmail, sendEmail } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import { formatAmount } from "@/lib/money";
import { currencyMeta } from "@/lib/money";

export type ProviderId = "stripe" | "paypal" | "sandbox";

export type ProviderAvailability = {
  id: ProviderId;
  labelEn: string;
  labelAr: string;
  available: boolean;
  live: boolean;
  note: string;
};

export function providerAvailability(testMode: boolean): ProviderAvailability[] {
  const stripeLive = Boolean(process.env.STRIPE_SECRET_KEY);
  const paypalLive = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  return [
    {
      id: "stripe",
      labelEn: "Card, Apple Pay & Google Pay",
      labelAr: "بطاقة، Apple Pay و Google Pay",
      available: stripeLive,
      live: stripeLive,
      note: stripeLive ? "Stripe live keys detected on the server." : "Add STRIPE_SECRET_KEY on the server to enable.",
    },
    {
      id: "paypal",
      labelEn: "PayPal",
      labelAr: "PayPal",
      available: paypalLive,
      live: paypalLive,
      note: paypalLive ? "PayPal credentials detected on the server." : "Add PAYPAL_CLIENT_ID & PAYPAL_CLIENT_SECRET to enable.",
    },
    {
      id: "sandbox",
      labelEn: "Secure test gateway",
      labelAr: "بوابة الاختبار الآمنة",
      available: testMode || (!stripeLive && !paypalLive),
      live: false,
      note: "Deterministic sandbox used to verify every payment path before going live.",
    },
  ];
}

export class PaymentError extends Error {}

function paypalBase() {
  return process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new PaymentError("PayPal credentials are not configured.");
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new PaymentError("PayPal authentication failed.");
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new PaymentError("PayPal access token missing.");
  return data.access_token;
}

export async function createProviderCheckout(input: {
  order: typeof orders.$inferSelect;
  origin: string;
  provider: ProviderId;
}): Promise<{ redirectUrl: string; reference: string }> {
  const { order, origin, provider } = input;
  const successUrl = `${origin}/checkout/success/${order.orderNumber}?at=${encodeURIComponent(order.accessToken)}&provider=${provider}`;
  const cancelUrl = `${origin}/checkout/success/${order.orderNumber}?at=${encodeURIComponent(order.accessToken)}&provider=${provider}&state=cancelled`;

  if (provider === "sandbox") {
    return {
      redirectUrl: `/checkout/pay/${order.orderNumber}?at=${encodeURIComponent(order.accessToken)}`,
      reference: `sandbox_${crypto.randomUUID()}`,
    };
  }

  if (provider === "stripe") {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new PaymentError("Stripe is not configured yet.");
    const currency = currencyMeta(order.currency).code.toLowerCase();
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", `${successUrl}&session_id={CHECKOUT_SESSION_ID}`);
    body.set("cancel_url", cancelUrl);
    body.set("customer_email", order.email);
    body.set("client_reference_id", order.orderNumber);
    body.set("metadata[order_number]", order.orderNumber);
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", currency);
    body.set("line_items[0][price_data][unit_amount]", String(order.totalCents));
    body.set("line_items[0][price_data][product_data][name]", `Astralium order ${order.orderNumber}`);
    body.set("line_items[0][price_data][product_data][description]", "Digital goods — instant delivery after payment confirmation");
    if (currency === "usd") {
      body.set("payment_method_types[0]", "card");
      body.set("payment_method_types[1]", "link");
    }
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await response.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!response.ok || !data.url || !data.id) throw new PaymentError(data.error?.message ?? "Stripe session creation failed.");
    return { redirectUrl: data.url, reference: data.id };
  }

  const token = await paypalAccessToken();
  const meta = currencyMeta(order.currency);
  const response = await fetch(`${paypalBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: order.orderNumber,
          description: `Astralium order ${order.orderNumber}`,
          amount: { currency_code: meta.code, value: (order.totalCents / 100).toFixed(2) },
        },
      ],
      application_context: {
        brand_name: "Astralium Digitale Store",
        user_action: "PAY_NOW",
        return_url: successUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  const data = (await response.json()) as {
    id?: string;
    links?: { rel: string; href: string }[];
    message?: string;
  };
  const approve = data.links?.find((link) => link.rel === "approve")?.href;
  if (!response.ok || !approve || !data.id) throw new PaymentError(data.message ?? "PayPal order creation failed.");
  return { redirectUrl: approve, reference: data.id };
}

export async function capturePayPalOrder(paypalOrderId: string): Promise<string> {
  const token = await paypalAccessToken();
  const response = await fetch(`${paypalBase()}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = (await response.json()) as {
    status?: string;
    purchase_units?: { payments?: { captures?: { id: string; status: string }[] } }[];
    message?: string;
  };
  if (!response.ok) throw new PaymentError(data.message ?? "PayPal capture failed.");
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  if (data.status !== "COMPLETED" || !capture || capture.status !== "COMPLETED") {
    throw new PaymentError("PayPal did not complete the payment.");
  }
  return capture.id;
}

/* --------------------------------- fulfilment ------------------------------- */

export async function markOrderPaid(input: {
  orderNumber: string;
  provider: ProviderId;
  reference: string;
  origin: string;
}): Promise<{ alreadyProcessed: boolean; order: typeof orders.$inferSelect }> {
  const settings = await getSettings();
  const paidAt = new Date();
  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.orderNumber, input.orderNumber)).for("update").limit(1);
    const order = rows[0];
    if (!order) throw new PaymentError("Order not found.");
    if (order.status === "paid" || order.status === "refunded") {
      return { alreadyProcessed: true, order };
    }
    if (order.status === "cancelled") throw new PaymentError("Order was cancelled.");
    const [updated] = await tx
      .update(orders)
      .set({
        status: "paid",
        paidAt,
        paymentProvider: input.provider,
        paymentRef: input.reference,
        updatedAt: paidAt,
      })
      .where(eq(orders.id, order.id))
      .returning();
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    for (const item of items) {
      await tx
        .update(products)
        .set({ salesCount: sql`${products.salesCount} + ${item.quantity}`, updatedAt: paidAt })
        .where(eq(products.id, item.productId));
    }
    if (order.couponCode) {
      await tx
        .update(coupons)
        .set({ redemptions: sql`${coupons.redemptions} + 1` })
        .where(eq(coupons.code, order.couponCode));
    }
    await tx
      .insert(webhookEvents)
      .values({
        provider: input.provider,
        eventId: `${input.orderNumber}:${input.reference}`,
        kind: "payment.confirmed",
        payload: { orderNumber: input.orderNumber, reference: input.reference, amount: order.totalCents, currency: order.currency },
        status: "processed",
      })
      .onConflictDoNothing();
    return { alreadyProcessed: false, order: updated };
  });

  if (!result.alreadyProcessed) {
    const itemRows = await db
      .select({ item: orderItems, product: products })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, result.order.id));
    const emailItems = itemRows.map((row) => ({
      title: row.product.title,
      url: `${input.origin}${downloadUrl(result.order.orderNumber, row.product.id)}`,
    }));
    await sendEmail({
      to: result.order.email,
      subject: `تم تأكيد طلبك ${result.order.orderNumber} — Astralium Digitale Store`,
      body: orderReceiptEmail({
        name: result.order.name,
        orderNumber: result.order.orderNumber,
        items: emailItems,
        total: formatAmount(result.order.totalCents, result.order.currency, result.order.locale),
        provider: input.provider,
        supportEmail: settings.supportEmail,
      }),
      orderNumber: result.order.orderNumber,
    });
  }

  return result;
}

export async function markOrderFailed(orderNumber: string, reason: string, provider: ProviderId) {
  await db
    .update(orders)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(orders.orderNumber, orderNumber));
  await db
    .insert(webhookEvents)
    .values({
      provider,
      eventId: `${orderNumber}:failed:${Date.now()}`,
      kind: "payment.failed",
      payload: { reason },
      status: "processed",
    })
    .onConflictDoNothing();
}

export async function refundOrder(orderNumber: string): Promise<{ ok: boolean; message: string }> {
  const rows = await db.select().from(orders).where(eq(orders.orderNumber, orderNumber)).limit(1);
  const order = rows[0];
  if (!order) return { ok: false, message: "الطلب غير موجود." };
  if (order.status !== "paid") return { ok: false, message: "لا يمكن استرجاع طلب غير مدفوع." };

  if (order.paymentProvider === "stripe" && process.env.STRIPE_SECRET_KEY && order.paymentRef) {
    try {
      const key = process.env.STRIPE_SECRET_KEY;
      const sessionResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${order.paymentRef}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const session = (await sessionResponse.json()) as { payment_intent?: string };
      if (session.payment_intent) {
        const refund = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ payment_intent: session.payment_intent }),
        });
        if (!refund.ok) return { ok: false, message: "رفض Stripe عملية الاسترجاع." };
      }
    } catch {
      return { ok: false, message: "تعذّر الاتصال بـ Stripe للاسترجاع." };
    }
  }

  if (order.paymentProvider === "paypal" && order.paymentRef && process.env.PAYPAL_CLIENT_ID) {
    try {
      const token = await paypalAccessToken();
      const refund = await fetch(`${paypalBase()}/v2/payments/captures/${order.paymentRef}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
      });
      if (!refund.ok) return { ok: false, message: "رفض PayPal عملية الاسترجاع." };
    } catch {
      return { ok: false, message: "تعذّر الاتصال بـ PayPal للاسترجاع." };
    }
  }

  await db
    .update(orders)
    .set({ status: "refunded", refundedAt: new Date(), updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  await db
    .insert(webhookEvents)
    .values({
      provider: order.paymentProvider,
      eventId: `${orderNumber}:refund:${Date.now()}`,
      kind: "payment.refunded",
      payload: { orderNumber },
      status: "processed",
    })
    .onConflictDoNothing();
  await sendEmail({
    to: order.email,
    subject: `تم استرجاع مبلغ الطلب ${orderNumber}`,
    body: `مرحبًا ${order.name},\n\nتم استرجاع مبلغ الطلب ${orderNumber} بالكامل (${formatAmount(order.totalCents, order.currency, order.locale)}).\nقد يستغرق وصول المبلغ إلى وسيلة الدفع من 5 إلى 10 أيام عمل.\n\nAstralium Digitale Store`,
    orderNumber,
  });
  return { ok: true, message: "تم تنفيذ الاسترجاع وإلغاء صلاحية روابط التحميل." };
}

/* -------------------------------- signatures -------------------------------- */

export function verifyStripeSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split("=");
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return false;
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function verifyPayPalWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || !process.env.PAYPAL_CLIENT_ID) return false;
  try {
    const token = await paypalAccessToken();
    const response = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: headers.get("paypal-auth-algo"),
        cert_url: headers.get("paypal-cert-url"),
        transmission_id: headers.get("paypal-transmission-id"),
        transmission_sig: headers.get("paypal-transmission-sig"),
        transmission_time: headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    });
    const data = (await response.json()) as { verification_status?: string };
    return data.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}
