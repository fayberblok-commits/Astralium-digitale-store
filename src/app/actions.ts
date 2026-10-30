"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contactMessages,
  coupons,
  customers,
  newsletterSubscribers,
  orderItems,
  orders,
  products,
  ticketMessages,
  tickets,
} from "@/db/schema";
import { createCustomerSession, getCustomerSession, registerLoginAttempt, revokeCustomerSession, writeAudit } from "@/lib/auth";
import { scryptHash, randomToken, verifyPassword } from "@/lib/crypto";
import { getLocale } from "@/lib/locale";
import { CURRENCIES, computeTotals, convertFromUsd } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { validateCoupon } from "@/lib/store";
import { markOrderFailed, markOrderPaid, providerAvailability, type ProviderId } from "@/lib/payments";

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function text(value: unknown, max = 4000): string {
  return String(value ?? "").trim().slice(0, max);
}

function orderNumber(): string {
  return `AST-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function subscribeNewsletter(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, message: "يرجى إدخال بريد إلكتروني صحيح." };
  }
  const locale = await getLocale();
  try {
    await db.insert(newsletterSubscribers).values({ email, locale }).onConflictDoNothing();
    return { ok: true, message: "تم تسجيلك في النشرة البريدية بنجاح." };
  } catch {
    return { ok: false, message: "تعذّر التسجيل حاليًا، حاول لاحقًا." };
  }
}

export async function submitContact(formData: FormData) {
  const name = text(formData.get("name"), 120);
  const email = normalizeEmail(formData.get("email"));
  const subject = text(formData.get("subject"), 180);
  const message = text(formData.get("message"), 4000);
  if (!name || !email.includes("@") || !subject || message.length < 10) {
    redirect("/contact?state=invalid");
  }
  await db.insert(contactMessages).values({ name, email, subject, message });
  redirect("/contact?state=sent");
}

export async function createSupportTicket(formData: FormData) {
  const name = text(formData.get("name"), 120);
  const email = normalizeEmail(formData.get("email"));
  const subject = text(formData.get("subject"), 180);
  const message = text(formData.get("message"), 4000);
  const relatedOrder = text(formData.get("orderNumber"), 40) || null;
  const locale = await getLocale();
  if (!name || !email.includes("@") || !subject || message.length < 10) {
    redirect("/support?state=invalid");
  }
  const number = `AST-T-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const [ticket] = await db
    .insert(tickets)
    .values({ ticketNumber: number, name, email, subject, message, orderNumber: relatedOrder, locale })
    .returning();
  await db.insert(ticketMessages).values({ ticketId: ticket.id, author: "customer", body: message });
  redirect(`/support?ticket=${encodeURIComponent(number)}`);
}

export async function createCheckoutOrder(formData: FormData) {
  const slug = text(formData.get("product"), 190);
  const customer = await getCustomerSession();
  const email = normalizeEmail(formData.get("email") || customer?.email);
  const name = text(formData.get("name"), 120) || customer?.name || "";
  const country = text(formData.get("country"), 2).toUpperCase() || "SA";
  const requestedCurrency = text(formData.get("currency"), 3).toUpperCase();
  const currency = CURRENCIES.some((item) => item.code === requestedCurrency) ? requestedCurrency : "USD";
  const couponInput = text(formData.get("coupon"), 40).toUpperCase();
  const locale = await getLocale();
  const settings = await getSettings();

  const productRows = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  const product = productRows[0];
  const fallback = `/checkout?product=${encodeURIComponent(slug)}${couponInput ? `&coupon=${encodeURIComponent(couponInput)}` : ""}`;

  if (!product || product.status !== "active") redirect(`${fallback}&state=unavailable`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || name.length < 2) redirect(`${fallback}&state=details`);

  const owned = await db
    .select({ orderNumber: orders.orderNumber, token: orders.accessToken })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.email, email), eq(orderItems.productId, product.id), eq(orders.status, "paid")))
    .limit(1);
  if (owned[0]) {
    redirect(`/checkout/success/${owned[0].orderNumber}?at=${encodeURIComponent(owned[0].token)}&state=already_owned`);
  }

  let discountUsdCents = 0;
  let appliedCoupon: string | null = null;
  if (couponInput) {
    const result = await validateCoupon(couponInput, product.priceCents);
    if (result.ok) {
      discountUsdCents = result.discountUsdCents;
      appliedCoupon = result.coupon.code;
    } else {
      redirect(`${fallback}&state=coupon&message=${encodeURIComponent(result.message)}`);
    }
  }

  const totals = computeTotals({
    usdSubtotalCents: product.priceCents,
    currency,
    discountCents: discountUsdCents,
    taxPercent: settings.taxPercent,
  });

  const accessToken = randomToken(24);
  let reference: string | null = null;
  let createdOrderId: number | null = null;
  let createdOrderNumber = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = orderNumber();
    try {
      const [created] = await db
        .insert(orders)
        .values({
          orderNumber: candidate,
          customerId: customer?.id ?? null,
          email,
          name,
          country,
          locale,
          currency,
          fxRate: totals.fxRate,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          baseSubtotalCents: totals.baseSubtotalCents,
          baseTotalCents: totals.baseTotalCents,
          couponCode: appliedCoupon,
          status: "pending",
          paymentProvider: "sandbox",
          accessToken,
        })
        .returning();
      await db.insert(orderItems).values({
        orderId: created.id,
        productId: product.id,
        titleSnapshot: product.title,
        unitPriceCents: convertFromUsd(product.priceCents, currency),
        quantity: 1,
        downloadLimit: product.downloadLimit,
      });
      reference = created.accessToken;
      createdOrderId = created.id;
      createdOrderNumber = created.orderNumber;
      break;
    } catch {
      continue;
    }
  }

  if (!createdOrderId || !reference) redirect(`${fallback}&state=unavailable`);

  const requestedProvider = text(formData.get("provider"), 20) as ProviderId;
  const availability = providerAvailability(settings.testMode);
  const chosen =
    availability.find((item) => item.id === requestedProvider && item.available)?.id ??
    availability.find((item) => item.id === "sandbox" && item.available)?.id ??
    availability.find((item) => item.available)?.id ??
    "sandbox";

  await db.update(orders).set({ paymentProvider: chosen }).where(eq(orders.id, createdOrderId));

  const { createProviderCheckout, PaymentError } = await import("@/lib/payments");
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  try {
    const orderRows = await db.select().from(orders).where(eq(orders.id, createdOrderId)).limit(1);
    const checkout = await createProviderCheckout({ order: orderRows[0], origin, provider: chosen });
    await db.update(orders).set({ paymentRef: checkout.reference }).where(eq(orders.id, createdOrderId));
    redirect(checkout.redirectUrl);
  } catch (error) {
    if (error instanceof PaymentError) {
      await db.update(orders).set({ status: "failed" }).where(eq(orders.id, createdOrderId));
      redirect(`${fallback}&state=gateway&message=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}

export async function simulateSandboxPayment(formData: FormData) {
  const number = text(formData.get("orderNumber"), 40);
  const token = text(formData.get("token"), 200);
  const outcome = text(formData.get("outcome"), 20);
  const settings = await getSettings();
  if (!settings.testMode) redirect("/checkout?state=test_disabled");

  const rows = await db.select().from(orders).where(eq(orders.orderNumber, number)).limit(1);
  const order = rows[0];
  if (!order || order.accessToken !== token) redirect("/checkout?state=invalid");
  if (order.status === "paid") {
    redirect(`/checkout/success/${order.orderNumber}?at=${encodeURIComponent(token)}&provider=sandbox`);
  }
  if (outcome === "fail") {
    await markOrderFailed(order.orderNumber, "sandbox_declined", "sandbox");
    redirect(`/checkout/pay/${order.orderNumber}?at=${encodeURIComponent(token)}&state=failed`);
  }
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  await markOrderPaid({
    orderNumber: order.orderNumber,
    provider: "sandbox",
    reference: `sandbox_${crypto.randomUUID()}`,
    origin,
  });
  await writeAudit("payment.sandbox_confirmed", "order", order.orderNumber, { amount: order.totalCents, currency: order.currency }, "gateway");
  redirect(`/checkout/success/${order.orderNumber}?at=${encodeURIComponent(token)}&provider=sandbox`);
}

/* ------------------------------- customer auth ------------------------------ */

export async function customerRegister(formData: FormData) {
  const name = text(formData.get("name"), 120);
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const referral = text(formData.get("ref"), 30).toUpperCase();
  const locale = await getLocale();
  if (name.length < 2) return { error: "يرجى إدخال الاسم الكامل." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "يرجى إدخال بريد إلكتروني صحيح." };
  if (password.length < 8) return { error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." };
  const existing = await db.select({ id: customers.id }).from(customers).where(eq(customers.email, email)).limit(1);
  if (existing[0]) return { error: "هذا البريد مسجّل مسبقًا. سجّل الدخول بدلًا من ذلك." };
  const code = `AST-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const [created] = await db
    .insert(customers)
    .values({
      name,
      email,
      passwordHash: scryptHash(password),
      locale,
      referralCode: code,
      referredBy: referral || null,
    })
    .returning();
  await createCustomerSession(created.id);
  redirect("/account?state=welcome");
}

export async function customerLogin(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const { isRateLimited } = await import("@/lib/auth");
  if (await isRateLimited(email, "customer")) {
    return { error: "محاولات كثيرة. انتظر 15 دقيقة ثم حاول مجددًا." };
  }
  const rows = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
  const customer = rows[0];
  if (!customer || !verifyPassword(password, customer.passwordHash)) {
    await registerLoginAttempt(email, false, "customer");
    return { error: "البريد أو كلمة المرور غير صحيحة." };
  }
  await registerLoginAttempt(email, true, "customer");
  await createCustomerSession(customer.id);
  redirect("/account?state=signed_in");
}

export async function customerLogout() {
  await revokeCustomerSession();
  redirect("/");
}

export async function updateCustomerProfile(formData: FormData) {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login");
  const name = text(formData.get("name"), 120);
  const country = text(formData.get("country"), 60);
  const marketing = formData.get("marketingOptIn") === "on";
  if (name.length >= 2) {
    await db
      .update(customers)
      .set({ name, country: country || null, marketingOptIn: marketing })
      .where(eq(customers.id, customer.id));
  }
  revalidatePath("/account");
  redirect("/account?state=profile_saved#settings");
}

export async function updateCustomerPassword(formData: FormData) {
  const customer = await getCustomerSession();
  if (!customer) redirect("/account/login");
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  if (next.length < 8) redirect("/account?state=password_short#settings");
  const rows = await db.select().from(customers).where(eq(customers.id, customer.id)).limit(1);
  const stored = rows[0];
  if (!stored || !verifyPassword(current, stored.passwordHash)) {
    redirect("/account?state=password_invalid#settings");
  }
  await db.update(customers).set({ passwordHash: scryptHash(next) }).where(eq(customers.id, customer.id));
  redirect("/account?state=password_saved#settings");
}

export async function requestRefund(formData: FormData) {
  const customer = await getCustomerSession();
  const orderNo = text(formData.get("orderNumber"), 40);
  const message = text(formData.get("message"), 2000);
  await db.insert(contactMessages).values({
    name: customer?.name ?? "زائر",
    email: customer?.email ?? "unknown@astralium.store",
    subject: `طلب استرجاع للطلب ${orderNo}`,
    message: message || "طلب استرجاع جديد بانتظار المراجعة.",
  });
  redirect("/account?state=refund_requested#purchases");
}

export async function validateCouponInput(formData: FormData) {
  const code = text(formData.get("code"), 40).toUpperCase();
  const slug = text(formData.get("product"), 190);
  const productRows = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  if (!productRows[0] || !code) redirect(`/checkout?product=${encodeURIComponent(slug)}&state=coupon_missing`);
  const result = await validateCoupon(code, productRows[0].priceCents);
  if (!result.ok) {
    redirect(`/checkout?product=${encodeURIComponent(slug)}&state=coupon&message=${encodeURIComponent(result.message)}`);
  }
  redirect(`/checkout?product=${encodeURIComponent(slug)}&coupon=${encodeURIComponent(code)}`);
}

export async function redeemCouponFromOffers(formData: FormData) {
  const code = text(formData.get("code"), 40).toUpperCase();
  redirect(`/catalog?coupon=${encodeURIComponent(code)}`);
}

export async function deactivateCouponSelf(): Promise<void> {
  await writeAudit("coupon.selfservice.noop", "coupon", null, {});
  revalidatePath("/offers");
}
