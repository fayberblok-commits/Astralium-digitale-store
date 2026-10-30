import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import { simulateSandboxPayment } from "@/app/actions";
import { getLocaleContext } from "@/lib/locale";
import { formatAmount } from "@/lib/money";
import { getOrderWithItems } from "@/lib/store";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "بوابة الدفع الآمنة" };

type Props = { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ at?: string; state?: string }> };

export default async function SandboxPaymentPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const query = await searchParams;
  const { locale, t } = await getLocaleContext();
  const [data, settings] = await Promise.all([getOrderWithItems(orderNumber), getSettings()]);

  if (!data) notFound();
  const { order, items } = data;
  if (!query.at || query.at !== order.accessToken) {
    redirect(`/checkout?state=invalid`);
  }
  if (order.status === "paid") {
    redirect(`/checkout/success/${order.orderNumber}?at=${encodeURIComponent(order.accessToken)}&provider=sandbox`);
  }
  if (!settings.testMode) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Alert tone="error">
          {locale === "ar" ? "بوابة الاختبار موقوفة. أكمل الدفع من الصفحة السابقة عبر Stripe أو PayPal." : "The test gateway is disabled. Complete payment via Stripe or PayPal on the previous page."}
        </Alert>
        <Link href={`/checkout?product=${items[0]?.product.slug ?? ""}`} className="btn-gold mt-4">
          {t("back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-[#d9b26a]">{locale === "ar" ? "بوابة دفع آمنة" : "Secure payment gateway"}</p>
            <h1 className="mt-1 font-display text-2xl text-[#f8f3e6]">{locale === "ar" ? "تأكيد الدفع" : "Confirm payment"}</h1>
          </div>
          <span className="chip">{locale === "ar" ? "وضع اختبار" : "Test mode"}</span>
        </div>

        {query.state === "failed" ? (
          <div className="mt-4">
            <Alert tone="error">
              {locale === "ar"
                ? "تمت محاكاة دفع فاشل. لم يتم تسليم أي ملف، ولم يُخصم أي مبلغ. يمكنك إعادة المحاولة."
                : "A failed payment was simulated. No file was delivered and no charge was made. You can retry."}
            </Alert>
          </div>
        ) : null}

        <dl className="mt-4 grid gap-3 text-[12.5px] sm:grid-cols-2">
          <div className="rounded-xl bg-white/[0.03] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[#a99c83]">{locale === "ar" ? "رقم الطلب" : "Order"}</dt>
            <dd className="font-mono text-[#f0dcae]">{order.orderNumber}</dd>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[#a99c83]">{locale === "ar" ? "المشتري" : "Buyer"}</dt>
            <dd className="text-[#f4efe3]">{order.name} · {order.email}</dd>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[#a99c83]">{locale === "ar" ? "المنتج" : "Product"}</dt>
            <dd className="text-[#f4efe3]">{items.map((item) => item.product.title).join(", ")}</dd>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-3 py-2">
            <dt className="text-[10px] uppercase tracking-[0.18em] text-[#a99c83]">{t("total")}</dt>
            <dd className="tabular text-[#f0dcae]">{formatAmount(order.totalCents, order.currency, locale)}</dd>
          </div>
        </dl>

        <div className="mt-5 rounded-xl border border-[rgba(217,178,106,0.25)] bg-[rgba(217,178,106,0.05)] p-3 text-[11.5px] leading-relaxed text-[#d7c8a4]">
          {locale === "ar"
            ? "هذه بوابة اختبار حتمية تعمل بنفس مسار التسليم الحقيقي: تأكيد الدفع ← إنشاء الترخيص ← روابط تحميل موقّعة. لا تحتوي أي بيانات بطاقة."
            : "This deterministic test gateway follows the real fulfilment path: payment confirmation → licence → signed download links. It holds no card data."}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <form action={simulateSandboxPayment} className="flex-1">
            <input type="hidden" name="orderNumber" value={order.orderNumber} />
            <input type="hidden" name="token" value={order.accessToken} />
            <input type="hidden" name="outcome" value="success" />
            <button type="submit" className="btn-gold w-full">
              {locale === "ar" ? "محاكاة دفع ناجح" : "Simulate successful payment"}
            </button>
          </form>
          <form action={simulateSandboxPayment} className="flex-1">
            <input type="hidden" name="orderNumber" value={order.orderNumber} />
            <input type="hidden" name="token" value={order.accessToken} />
            <input type="hidden" name="outcome" value="fail" />
            <button type="submit" className="btn-ghost w-full">
              {locale === "ar" ? "محاكاة دفع فاشل" : "Simulate failed payment"}
            </button>
          </form>
        </div>

        <Link href={`/checkout?product=${items[0]?.product.slug ?? ""}`} className="mt-4 block text-center text-[11.5px] text-[#9d99ad] hover:text-[#f0dcae]">
          {locale === "ar" ? "إلغاء والعودة إلى الدفع" : "Cancel and return to checkout"}
        </Link>
      </div>
    </div>
  );
}
