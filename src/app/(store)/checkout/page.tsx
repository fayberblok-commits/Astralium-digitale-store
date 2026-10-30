import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Alert, CoverArt } from "@/components/ui";
import { createCheckoutOrder, validateCouponInput } from "@/app/actions";
import { getCustomerSession } from "@/lib/auth";
import { getLocaleContext } from "@/lib/locale";
import { CURRENCIES, computeTotals, currencyMeta, formatAmount } from "@/lib/money";
import { providerAvailability } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { getProductBySlug, validateCoupon } from "@/lib/store";

export const metadata: Metadata = { title: "إتمام الشراء" };

const COUNTRIES = [
  { code: "SA", ar: "السعودية", en: "Saudi Arabia" },
  { code: "AE", ar: "الإمارات", en: "United Arab Emirates" },
  { code: "QA", ar: "قطر", en: "Qatar" },
  { code: "KW", ar: "الكويت", en: "Kuwait" },
  { code: "BH", ar: "البحرين", en: "Bahrain" },
  { code: "OM", ar: "عُمان", en: "Oman" },
  { code: "EG", ar: "مصر", en: "Egypt" },
  { code: "MA", ar: "المغرب", en: "Morocco" },
  { code: "DZ", ar: "الجزائر", en: "Algeria" },
  { code: "TN", ar: "تونس", en: "Tunisia" },
  { code: "JO", ar: "الأردن", en: "Jordan" },
  { code: "TR", ar: "تركيا", en: "Türkiye" },
  { code: "GB", ar: "المملكة المتحدة", en: "United Kingdom" },
  { code: "US", ar: "الولايات المتحدة", en: "United States" },
  { code: "FR", ar: "فرنسا", en: "France" },
  { code: "DE", ar: "ألمانيا", en: "Germany" },
  { code: "ES", ar: "إسبانيا", en: "Spain" },
  { code: "IN", ar: "الهند", en: "India" },
  { code: "JP", ar: "اليابان", en: "Japan" },
  { code: "OTHER", ar: "دولة أخرى", en: "Other country" },
];

type SearchParams = Promise<{ product?: string; coupon?: string; state?: string; message?: string }>;

export default async function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getLocaleContext();
  const settings = await getSettings();
  const customer = await getCustomerSession();
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";

  if (!params.product) redirect("/catalog?state=select_product");
  const product = await getProductBySlug(params.product);
  if (!product || product.status !== "active") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Alert tone="error">
          {locale === "ar" ? "هذا المنتج غير متاح للشراء الآن." : "This product is not available for purchase right now."}
        </Alert>
        <Link href="/catalog" className="btn-gold mt-4">
          {t("browse")}
        </Link>
      </div>
    );
  }

  const couponCode = (params.coupon ?? "").toUpperCase();
  const couponResult = couponCode ? await validateCoupon(couponCode, product.priceCents) : null;
  const discountUsdCents = couponResult?.ok ? couponResult.discountUsdCents : 0;
  const totals = computeTotals({
    usdSubtotalCents: product.priceCents,
    currency,
    discountCents: discountUsdCents,
    taxPercent: settings.taxPercent,
  });
  const providers = providerAvailability(settings.testMode);
  const title = locale === "ar" ? product.title : product.titleEn || product.title;

  const errorMessage =
    params.state === "details"
      ? locale === "ar"
        ? "يرجى إدخال الاسم والبريد الإلكتروني بشكل صحيح."
        : "Please provide a valid name and email address."
      : params.state === "coupon"
        ? params.message ?? (locale === "ar" ? "الكوبون غير صالح." : "This coupon is not valid.")
        : params.state === "gateway"
          ? `${locale === "ar" ? "تعذّر بدء الدفع:" : "Could not start payment:"} ${params.message ?? ""}`
          : params.state === "test_disabled"
            ? locale === "ar"
              ? "بوابة الاختبار موقوفة لأن المتجر في الوضع الحقيقي. اختر Stripe أو PayPal."
              : "Test gateway is disabled because live payments are active. Choose Stripe or PayPal."
            : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("checkout")}</p>
      <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{t("checkout")}</h1>
      <p className="mt-2 text-[13px] text-[#a9a4b8]">
        {locale === "ar"
          ? "خطوة واحدة فقط: بياناتك، طريقة الدفع، ثم يصل الملف فور تأكيد الدفع."
          : "One step only: your details, payment method, then the file is delivered on confirmation."}
      </p>

      {errorMessage ? (
        <div className="mt-5">
          <Alert tone="error">{errorMessage}</Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <form action={createCheckoutOrder} className="glass rounded-2xl p-5">
          <input type="hidden" name="product" value={product.slug} />
          <input type="hidden" name="coupon" value={couponResult?.ok ? couponCode : ""} />
          <input type="hidden" name="currency" value={currency} />

          <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "بيانات المشتري" : "Buyer details"}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="co-name" className="mb-1 block text-[11px] text-[#b3a98f]">
                {t("full_name")}
              </label>
              <input id="co-name" name="name" required minLength={2} defaultValue={customer?.name ?? ""} className="field" placeholder={locale === "ar" ? "الاسم كما في الفاتورة" : "Name as on the invoice"} />
            </div>
            <div>
              <label htmlFor="co-email" className="mb-1 block text-[11px] text-[#b3a98f]">
                {t("email")}
              </label>
              <input id="co-email" name="email" type="email" required defaultValue={customer?.email ?? ""} className="field" dir="ltr" placeholder="name@example.com" />
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="co-country" className="mb-1 block text-[11px] text-[#b3a98f]">
                {locale === "ar" ? "الدولة" : "Country"}
              </label>
              <select id="co-country" name="country" defaultValue="SA" className="field">
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {locale === "ar" ? country.ar : country.en}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="co-currency" className="mb-1 block text-[11px] text-[#b3a98f]">
                {t("currency")}
              </label>
              <input id="co-currency" value={`${currency} — ${locale === "ar" ? currencyMeta(currency).labelAr : currencyMeta(currency).labelEn}`} readOnly className="field text-[#a9a4b8]" />
              <p className="mt-1 text-[10px] text-[#807c91]">
                {locale === "ar" ? "غيّر العملة من تذييل الصفحة ثم أعد التحميل." : "Change currency in the footer, then reload."}
              </p>
            </div>
          </div>

          <h2 className="mt-6 font-display text-xl text-[#f4efe3]">{t("payment_method")}</h2>
          <div className="mt-3 space-y-2">
            {providers.map((provider, index) => (
              <label
                key={provider.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
                  provider.available ? "border-white/10 bg-white/[0.02] hover:border-[rgba(217,178,106,0.4)]" : "border-white/5 bg-white/[0.01] opacity-50"
                }`}
              >
                <input
                  type="radio"
                  name="provider"
                  value={provider.id}
                  defaultChecked={index === 0}
                  disabled={!provider.available}
                  className="mt-1 h-4 w-4"
                  required
                />
                <span className="flex-1">
                  <span className="block text-[12.5px] text-[#efe9db]">{locale === "ar" ? provider.labelAr : provider.labelEn}</span>
                  <span className="block text-[10.5px] text-[#8f8ba2]">{provider.note}</span>
                </span>
                <span className="chip">{provider.live ? "LIVE" : provider.id === "sandbox" ? (locale === "ar" ? "اختبار" : "TEST") : "—"}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#807c91]">
            {locale === "ar"
              ? "لا يُخصم المبلغ إلا مرة واحدة، ويُتحقق من الدفع عبر البوابة أو Webhook موقّع قبل تسليم الملف. لا يمرّ أي رقم بطاقة عبر خوادم المتجر."
              : "You are charged once; payment is verified by the gateway or a signed webhook before delivery. No card number passes through our servers."}
          </p>

          <label className="mt-4 flex items-start gap-2 text-[11.5px] leading-relaxed text-[#b8b3c5]">
            <input type="checkbox" required className="mt-0.5 h-4 w-4" />
            <span>
              {locale === "ar" ? "أوافق على " : "I agree to the "}
              <Link href="/terms" className="text-[#e6d6ae] underline underline-offset-2">
                {t("terms")}
              </Link>{" "}
              {locale === "ar" ? "و" : "and "}
              <Link href="/refunds" className="text-[#e6d6ae] underline underline-offset-2">
                {t("refunds")}
              </Link>
              {locale === "ar" ? `، وأعلم أن الاسترجاع متاح خلال ${settings.refundWindowDays} يومًا وفق الشروط.` : `, and understand refunds are available within ${settings.refundWindowDays} days under the policy.`}
            </span>
          </label>

          <button type="submit" className="btn-gold mt-4 w-full">
            {t("pay_now")} — {formatAmount(totals.totalCents, currency, locale)}
          </button>
          <p className="mt-2 text-center text-[10.5px] text-[#807c91]">
            {locale === "ar" ? "بالمتابعة تُنشأ فاتورة باسمك وتُرسل إلى بريدك بعد التأكيد." : "Continuing creates an invoice in your name, emailed after confirmation."}
          </p>
        </form>

        <aside className="space-y-4">
          <div className="glass rounded-2xl p-4">
            <p className="mb-2 text-[10px] uppercase tracking-[0.24em] text-[#d9b26a]">{locale === "ar" ? "ملخص الطلب" : "Order summary"}</p>
            <div className="flex items-center gap-3">
              <CoverArt title={title} coverStyle={product.coverStyle} glyph={product.coverGlyph} compact className="h-20 w-16 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] text-[#f4efe3]">{title}</p>
                <p className="text-[10.5px] text-[#8f8ba2]">{product.format}</p>
                <p className="tabular mt-1 text-[12px] text-[#e6d6ae]">{formatAmount(totals.subtotalCents, currency, locale)}</p>
              </div>
            </div>

            <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-[12px]">
              <div className="flex items-center justify-between text-[#b3aec1]">
                <span>{t("subtotal")}</span>
                <span className="tabular">{formatAmount(totals.subtotalCents, currency, locale)}</span>
              </div>
              {totals.discountCents > 0 ? (
                <div className="flex items-center justify-between text-emerald-300">
                  <span>
                    {t("discount")} {couponResult?.ok ? `(${couponCode})` : ""}
                  </span>
                  <span className="tabular">− {formatAmount(totals.discountCents, currency, locale)}</span>
                </div>
              ) : null}
              {totals.taxCents > 0 ? (
                <div className="flex items-center justify-between text-[#b3aec1]">
                  <span>
                    {locale === "ar" ? settings.taxLabelAr : settings.taxLabelEn} ({settings.taxPercent}%)
                  </span>
                  <span className="tabular">{formatAmount(totals.taxCents, currency, locale)}</span>
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[14px] text-[#f6f1e3]">
                <span>{t("total")}</span>
                <span className="tabular font-semibold text-[#f0dcae]">{formatAmount(totals.totalCents, currency, locale)}</span>
              </div>
            </div>
          </div>

          <form action={validateCouponInput} className="glass rounded-2xl p-4">
            <label htmlFor="coupon" className="mb-2 block text-[10px] uppercase tracking-[0.24em] text-[#d9b26a]">
              {t("coupon")}
            </label>
            <input type="hidden" name="product" value={product.slug} />
            <div className="flex gap-2">
              <input id="coupon" name="code" defaultValue={couponCode} className="field text-[12px]" dir="ltr" placeholder="ASTRAL10" />
              <button type="submit" className="btn-ghost px-3 py-2 text-[11.5px]">
                {t("apply")}
              </button>
            </div>
            {couponResult && !couponResult.ok ? <p className="mt-2 text-[11px] text-rose-300">{couponResult.message}</p> : null}
            {couponResult?.ok ? <p className="mt-2 text-[11px] text-emerald-300">{locale === "ar" ? "تم تطبيق الكوبون بنجاح." : "Coupon applied."}</p> : null}
          </form>

          <div className="glass rounded-2xl p-4 text-[11.5px] leading-relaxed text-[#a9a4b8]">
            <p className="mb-1 font-display text-sm text-[#f0dcae]">{locale === "ar" ? "ما بعد الدفع" : "After payment"}</p>
            <ul className="space-y-1.5">
              <li>{locale === "ar" ? "• رابط التحميل يظهر مباشرة في صفحة النجاح." : "• The download link appears on the success page."}</li>
              <li>{locale === "ar" ? "• نسخة الفاتورة متاحة للطباعة." : "• Your invoice is ready to print."}</li>
              <li>{locale === "ar" ? "• تبقى الملفات في حسابك دائمًا." : "• Files stay in your account permanently."}</li>
            </ul>
            <Link href="/support" className="mt-3 block text-[#e6d6ae] hover:underline">
              {locale === "ar" ? "مشكلة في الدفع؟ افتح تذكرة دعم ←" : "Payment issue? Open a support ticket ←"}
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
