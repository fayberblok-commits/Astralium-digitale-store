import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui";
import { getCustomerSession } from "@/lib/auth";
import { downloadUrl } from "@/lib/downloads";
import { getLocaleContext, formatDateTime } from "@/lib/locale";
import { formatAmount } from "@/lib/money";
import { capturePayPalOrder, markOrderPaid, PaymentError } from "@/lib/payments";
import { getOrderWithItems } from "@/lib/store";

export const metadata: Metadata = { title: "تأكيد الطلب" };

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ at?: string; provider?: string; state?: string; session_id?: string; token?: string }>;
};

async function verifyStripeSession(order: Awaited<ReturnType<typeof getOrderWithItems>>) {
  if (!order || !process.env.STRIPE_SECRET_KEY || !order.order.paymentRef) return false;
  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${order.order.paymentRef}`, {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    const data = (await response.json()) as { payment_status?: string; status?: string };
    return data.payment_status === "paid";
  } catch {
    return false;
  }
}

export default async function CheckoutSuccessPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  let query = await searchParams;
  const { locale, t } = await getLocaleContext();
  const customer = await getCustomerSession();
  let data = await getOrderWithItems(orderNumber);
  if (!data) notFound();

  const authorized = query.at === data.order.accessToken || (customer && customer.email === data.order.email);
  if (!authorized) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Alert tone="error">
          {locale === "ar"
            ? "رابط الطلب غير صالح أو منتهي. سجّل الدخول بالبريد المستخدم في الشراء لعرض الطلب."
            : "This order link is invalid or expired. Sign in with the purchasing email to view the order."}
        </Alert>
        <div className="mt-4 flex gap-2">
          <Link href="/account/login" className="btn-gold">
            {t("sign_in")}
          </Link>
          <Link href="/support" className="btn-ghost">
            {t("nav_support")}
          </Link>
        </div>
      </div>
    );
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  let captureError: string | null = null;

  if (data.order.status === "pending") {
    if (query.provider === "stripe" && (await verifyStripeSession(data))) {
      await markOrderPaid({
        orderNumber: data.order.orderNumber,
        provider: "stripe",
        reference: data.order.paymentRef ?? query.session_id ?? "stripe",
        origin,
      });
      data = (await getOrderWithItems(orderNumber)) ?? data;
    } else if (query.provider === "paypal" && query.token) {
      try {
        const captureId = await capturePayPalOrder(query.token);
        await markOrderPaid({ orderNumber: data.order.orderNumber, provider: "paypal", reference: captureId, origin });
        data = (await getOrderWithItems(orderNumber)) ?? data;
        query = { ...query, state: undefined };
      } catch (error) {
        captureError = error instanceof PaymentError ? error.message : "PayPal capture failed.";
      }
    }
  }

  const { order, items } = data;
  const isPaid = order.status === "paid";

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <div className="glass rounded-2xl p-6">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#d9b26a]">
              {isPaid
                ? locale === "ar"
                  ? "تم الدفع بنجاح"
                  : "Payment confirmed"
                : order.status === "refunded"
                  ? locale === "ar"
                    ? "تم استرجاع الطلب"
                    : "Order refunded"
                  : locale === "ar"
                    ? "بانتظار تأكيد الدفع"
                    : "Awaiting confirmation"}
            </p>
            <h1 className="mt-1.5 font-display text-3xl text-[#f8f3e6]">{order.orderNumber}</h1>
            <p className="mt-1 text-[12px] text-[#9d99ad]">{formatDateTime(order.paidAt ?? order.createdAt, locale)}</p>
          </div>
          <span className={`self-start rounded-full border px-3 py-1 text-[11px] ${isPaid ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-300/30 bg-amber-300/10 text-amber-100"}`}>
            {locale === "ar" ? (isPaid ? "مدفوع" : order.status === "refunded" ? "مسترجع" : "قيد المراجعة") : isPaid ? "Paid" : order.status === "refunded" ? "Refunded" : "Pending"}
          </span>
        </div>

        {query.state === "cancelled" ? (
          <div className="mt-4">
            <Alert tone="error">
              {locale === "ar" ? "تم إلغاء الدفع قبل إتمامه، ولم يُسلَّم أي ملف." : "Payment was cancelled before completion; no file was delivered."}{" "}
              <Link href={`/checkout?product=${items[0]?.product.slug ?? ""}`} className="underline">
                {locale === "ar" ? "أعد المحاولة" : "Try again"}
              </Link>
            </Alert>
          </div>
        ) : null}
        {query.state === "already_owned" ? (
          <div className="mt-4">
            <Alert tone="info">
              {locale === "ar" ? "لديك هذا المنتج بالفعل على بريدك، وهذه نسختك المتاحة للتحميل." : "You already own this product on this email; here is your existing copy."}
            </Alert>
          </div>
        ) : null}
        {captureError ? (
          <div className="mt-4">
            <Alert tone="error">
              {locale === "ar" ? "لم يؤكد PayPal العملية:" : "PayPal did not confirm the payment:"} {captureError}
            </Alert>
          </div>
        ) : null}
        {!isPaid && order.status !== "refunded" ? (
          <div className="mt-4">
            <Alert tone="info">
              {locale === "ar"
                ? "لم يصل تأكيد الدفع بعد. يتم التسليم فقط بعد تأكيد البوابة أو الـ Webhook. حدّث الصفحة بعد لحظات، أو تواصل مع الدعم برقم الطلب."
                : "Payment confirmation has not arrived yet. Delivery happens only after gateway or webhook confirmation. Refresh shortly or contact support with your order number."}
            </Alert>
          </div>
        ) : null}
        {order.status === "refunded" ? (
          <div className="mt-4">
            <Alert tone="info">
              {locale === "ar" ? "تم استرجاع هذا الطلب وإلغاء صلاحية روابط التحميل الخاصة به." : "This order was refunded and its download links have been revoked."}
            </Alert>
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[12px]">
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#a99c83]">{locale === "ar" ? "بيانات المشتري" : "Buyer"}</p>
            <p className="text-[#f4efe3]">{order.name}</p>
            <p className="text-[#a9a4b8]" dir="ltr">
              {order.email}
            </p>
            <p className="mt-1 text-[#8f8ba2]">
              {locale === "ar" ? "طريقة الدفع:" : "Method:"} {order.paymentProvider}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[12px]">
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#a99c83]">{locale === "ar" ? "المبالغ" : "Amounts"}</p>
            <div className="flex justify-between text-[#b3aec1]">
              <span>{t("subtotal")}</span>
              <span className="tabular">{formatAmount(order.subtotalCents, order.currency, locale)}</span>
            </div>
            {order.discountCents > 0 ? (
              <div className="flex justify-between text-emerald-300">
                <span>{t("discount")}</span>
                <span className="tabular">− {formatAmount(order.discountCents, order.currency, locale)}</span>
              </div>
            ) : null}
            {order.taxCents > 0 ? (
              <div className="flex justify-between text-[#b3aec1]">
                <span>{t("tax")}</span>
                <span className="tabular">{formatAmount(order.taxCents, order.currency, locale)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-white/10 pt-1.5 text-[#f0dcae]">
              <span>{t("total")}</span>
              <span className="tabular">{formatAmount(order.totalCents, order.currency, locale)}</span>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <h2 className="font-display text-xl text-[#f4efe3]">{t("downloads")}</h2>
          <div className="mt-2 space-y-2">
            {items.map(({ product, item }) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <div>
                  <p className="text-[12.5px] text-[#f2eddf]">{locale === "ar" ? product.title : product.titleEn || product.title}</p>
                  <p className="text-[10.5px] text-[#8f8ba2]">
                    {product.fileName ?? product.format} · {locale === "ar" ? "ترخيص شخصي" : "Personal licence"}
                  </p>
                </div>
                {isPaid ? (
                  <a href={downloadUrl(order.orderNumber, product.id)} className="btn-gold px-3.5 py-2 text-[11.5px]">
                    {locale === "ar" ? "تحميل الملف" : "Download file"}
                  </a>
                ) : (
                  <span className="chip">{locale === "ar" ? "ينتظر تأكيد الدفع" : "Awaiting payment"}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/invoice/${order.orderNumber}?at=${encodeURIComponent(order.accessToken)}`} className="btn-ghost px-3.5 py-2 text-[11.5px]">
            {locale === "ar" ? "عرض الفاتورة" : "View invoice"}
          </Link>
          {customer ? (
            <Link href="/account?tab=downloads" className="btn-ghost px-3.5 py-2 text-[11.5px]">
              {t("account_title")}
            </Link>
          ) : (
            <Link href="/account/register" className="btn-ghost px-3.5 py-2 text-[11.5px]">
              {locale === "ar" ? "أنشئ حسابًا لحفظ مشترياتك" : "Create an account to keep your purchases"}
            </Link>
          )}
          <Link href="/catalog" className="btn-ghost px-3.5 py-2 text-[11.5px]">
            {t("browse")}
          </Link>
        </div>

        <p className="mt-4 text-[10.5px] leading-relaxed text-[#807c91]">
          {locale === "ar"
            ? "أُرسلت نسخة الفاتورة وتأكيد الطلب إلى بريدك. روابط التحميل موقّعة وتنتهي خلال 72 ساعة، ويمكنك دائمًا إنشاء رابط جديد من حسابك."
            : "A copy of the invoice and confirmation was sent to your email. Download links are signed, expire in 72 hours, and can be regenerated from your account."}
        </p>
      </div>
    </div>
  );
}
