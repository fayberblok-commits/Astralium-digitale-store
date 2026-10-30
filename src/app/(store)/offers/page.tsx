import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { and, desc, eq, gte, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { coupons, products } from "@/db/schema";
import { ProductCard, SectionHeading } from "@/components/ui";
import { getLocaleContext, formatDate } from "@/lib/locale";
import { CURRENCIES, convertFromUsd, formatAmount } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { listProducts } from "@/lib/store";

export const metadata: Metadata = {
  title: "العروض والكوبونات",
  description: "أحدث عروض متجر Astralium Digitale Store والكوبونات النشطة وإصدارات بأسعار مخفّضة.",
};

export default async function OffersPage() {
  const { locale, t } = await getLocaleContext();
  const settings = await getSettings();
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";

  const [activeCoupons, discounted] = await Promise.all([
    db
      .select()
      .from(coupons)
      .where(and(eq(coupons.active, true), or(isNull(coupons.expiresAt), gte(coupons.expiresAt, new Date()))))
      .orderBy(desc(coupons.createdAt)),
    db
      .select()
      .from(products)
      .where(and(eq(products.status, "active"), isNotNull(products.compareAtCents)))
      .orderBy(desc(products.createdAt))
      .limit(6),
  ]);
  const fallback = discounted.length === 0 ? (await listProducts({ sort: "popular", perPage: 6 })).items : discounted;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <SectionHeading
        eyebrow={t("nav_offers")}
        title={locale === "ar" ? "عروض المتجر والكوبونات" : "Store offers & coupons"}
        description={
          locale === "ar"
            ? `كل كوبون هنا مُدارة من مكتب المدير ويعمل فورًا عند إتمام الشراء. مدة الاسترجاع ${settings.refundWindowDays} يومًا.`
            : `Every coupon here is managed from the owner's office and works instantly at checkout. ${settings.refundWindowDays}-day refund window.`
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-3">
          {activeCoupons.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-[13px] leading-relaxed text-[#a9a4b8]">
              {locale === "ar"
                ? "لا توجد كوبونات نشطة حاليًا. تُحدَّث هذه الصفحة تلقائيًا عند إنشاء عرض جديد من مكتب المدير."
                : "No active coupons right now. This page updates automatically when a new offer is created in the owner's office."}
            </div>
          ) : (
            activeCoupons.map((coupon) => (
              <div key={coupon.id} className="glass flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-lg tracking-[0.2em] text-[#f4e4bb]">{coupon.code}</span>
                    <span className="chip">{locale === "ar" ? "نشط" : "Active"}</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-[#a9a4b8]">
                    {coupon.kind === "percent"
                      ? `${coupon.value}% ${locale === "ar" ? "خصم على أي منتج" : "off any product"}`
                      : `${formatAmount(convertFromUsd(coupon.value, currency), currency, locale)} ${locale === "ar" ? "خصم ثابت" : "flat discount"}`}
                    {coupon.minSubtotalCents > 0
                      ? ` — ${locale === "ar" ? "حد أدنى" : "min."} ${(coupon.minSubtotalCents / 100).toFixed(2)} USD`
                      : ""}
                  </p>
                  <p className="mt-1 text-[11px] text-[#807c91]">
                    {coupon.expiresAt
                      ? `${locale === "ar" ? "ينتهي" : "Expires"} ${formatDate(coupon.expiresAt, locale)}`
                      : locale === "ar"
                        ? "بدون تاريخ انتهاء"
                        : "No expiry date"}
                    {coupon.maxRedemptions ? ` • ${coupon.maxRedemptions - coupon.redemptions} ${locale === "ar" ? "استخدام متبقٍ" : "left"}` : ""}
                  </p>
                </div>
                <Link href={`/catalog?coupon=${encodeURIComponent(coupon.code)}`} className="btn-gold whitespace-nowrap text-[12px]">
                  {locale === "ar" ? "استخدم الكوبون" : "Use coupon"}
                </Link>
              </div>
            ))
          )}
        </div>

        <div className="glass rounded-2xl p-5">
          <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "كيف يعمل الكوبون؟" : "How coupons work"}</h2>
          <ol className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-[#a9a4b8]">
            <li>{locale === "ar" ? "١. انسخ رمز الكوبون من القائمة." : "1. Copy a coupon code from the list."}</li>
            <li>{locale === "ar" ? "٢. أدخله في خانة الكوبون داخل صفحة الدفع ثم اضغط «تطبيق»." : "2. Enter it in the coupon field at checkout and apply."}</li>
            <li>{locale === "ar" ? "٣. يُحسب الخصم قبل الضريبة ويظهر في ملخص الطلب." : "3. The discount is calculated before tax and shown in your summary."}</li>
            <li>{locale === "ar" ? "٤. الكوبون يُستهلك مرة واحدة لكل طلب، ولا يمكن جمعه مع كوبون آخر." : "4. One coupon per order; coupons cannot be stacked."}</li>
          </ol>
          <div className="mt-4 rounded-xl border border-[rgba(217,178,106,0.25)] bg-[rgba(217,178,106,0.06)] p-3 text-[12px] text-[#d7c8a4]">
            {locale === "ar"
              ? "إذا رفض النظام كوبونًا، فغالبًا تجاوزت حد الاستخدام أو انتهت صلاحيته — تواصل مع الدعم وسنوضّح لك."
              : "If a coupon is rejected it has likely expired or reached its limit — contact support and we will clarify."}
          </div>
        </div>
      </div>

      <section className="mt-12">
        <SectionHeading
          eyebrow={locale === "ar" ? "أسعار مخفّضة" : "Reduced prices"}
          title={locale === "ar" ? "إصدارات بسعر أقل" : "Editions at a lower price"}
          action={{ href: "/catalog?sort=price_asc", label: t("view_all") }}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fallback.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              locale={locale}
              currency={currency}
              labels={{ details: t("details"), save: t("add_to_wishlist") }}
            />
          ))}
        </div>
      </section>

      <section className="glass mt-12 rounded-2xl p-6 text-center">
        <h2 className="font-display text-2xl text-[#f6f1e3]">{locale === "ar" ? "اقترح عرضًا لمكتب المدير" : "Suggest an offer"}</h2>
        <p className="mx-auto mt-2 max-w-2xl text-[13px] leading-relaxed text-[#a9a4b8]">
          {locale === "ar"
            ? "إذا كنت تنتظر عرضًا على منتج معيّن، أرسل لنا اسم المنتج عبر صفحة الاتصال وسيراجعه مكتب المدير."
            : "If you are waiting for an offer on a specific product, send us its name through the contact page for review."}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <Link href="/contact" className="btn-gold">
            {t("nav_contact")}
          </Link>
          <Link href="/support" className="btn-ghost">
            {t("nav_support")}
          </Link>
        </div>
        <p className="mt-4 text-[11px] text-[#807c91]">
          {locale === "ar" ? "الأسعار بالدولار الأمريكي وتُحوّل تلقائيًا إلى عملتك." : "Prices are in USD and converted automatically to your currency."}
          {" · "}
          {locale === "ar" ? "العملة المعروضة الآن: " : "Display currency: "}
          {currency}
        </p>
      </section>
    </div>
  );
}
