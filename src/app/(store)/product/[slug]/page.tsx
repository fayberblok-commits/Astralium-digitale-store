import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CoverArt, PriceTag, ProductCard, StarRating } from "@/components/ui";
import { WishlistButton } from "@/components/wishlist-button";
import { getLocaleContext, formatDate } from "@/lib/locale";
import { categoryLabel } from "@/lib/i18n";
import { CURRENCIES } from "@/lib/money";
import { getProductBySlug, getProductReviews, getRelatedProducts, ratingOf } from "@/lib/store";
import { getSettings } from "@/lib/settings";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "المنتج غير متوفر" };
  return {
    title: product.title,
    description: (product.subtitle || product.description).slice(0, 158),
    openGraph: { title: product.title, description: product.subtitle || product.description.slice(0, 150), type: "website" },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const { locale, t } = await getLocaleContext();
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const [reviews, related, settings] = await Promise.all([
    getProductReviews(product.id),
    getRelatedProducts(product, 3),
    getSettings(),
  ]);
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";
  const title = locale === "ar" ? product.title : product.titleEn || product.title;
  const subtitle = locale === "ar" ? product.subtitle : product.subtitleEn || product.subtitle;
  const description = locale === "ar" ? product.description : product.descriptionEn || product.description;
  const features = locale === "ar" ? product.features : product.featuresEn.length ? product.featuresEn : product.features;
  const rating = ratingOf(product);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description.slice(0, 300),
    category: categoryLabel(product.category, "en"),
    offers: {
      "@type": "Offer",
      price: (product.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: product.status === "active" ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
    },
    ...(rating > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: rating, reviewCount: product.ratingCount } } : {}),
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav aria-label="Breadcrumb" className="mb-5 text-[11px] text-[#8f8ba2]">
        <Link href="/" className="hover:text-[#f0dcae]">
          {t("nav_home")}
        </Link>
        <span className="mx-2">/</span>
        <Link href="/catalog" className="hover:text-[#f0dcae]">
          {t("nav_catalog")}
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/catalog?category=${product.category}`} className="hover:text-[#f0dcae]">
          {categoryLabel(product.category, locale)}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[#d8c8a2]">{title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <CoverArt title={title} coverStyle={product.coverStyle} glyph={product.coverGlyph} className="aspect-square w-full" />
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {[
              { ar: "تسليم فوري", en: "Instant delivery" },
              { ar: "دفع مشفّر", en: "Encrypted payment" },
              { ar: "وصول دائم", en: "Lifetime access" },
            ].map((item) => (
              <div key={item.en} className="glass rounded-xl px-2 py-2.5 text-[10.5px] text-[#c3bece]">
                {locale === "ar" ? item.ar : item.en}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">{categoryLabel(product.category, locale)}</span>
            <span className="chip">{product.format}</span>
            {product.featured ? <span className="chip">✦ {locale === "ar" ? "مختار" : "Curated"}</span> : null}
          </div>
          <h1 className="mt-3 font-display text-3xl leading-tight text-[#f8f3e6] sm:text-4xl">{title}</h1>
          {subtitle ? <p className="mt-3 text-[14px] leading-relaxed text-[#b3aec0]">{subtitle}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {rating > 0 ? <StarRating value={rating} count={product.ratingCount} /> : null}
            <span className="text-[11.5px] text-[#8f8ba2]">
              {product.salesCount} {locale === "ar" ? "عملية شراء" : "purchases"}
            </span>
          </div>

          <div className="glass mt-5 rounded-2xl p-5">
            <PriceTag usdCents={product.priceCents} compareAtCents={product.compareAtCents} currency={currency} locale={locale} large />
            {settings.taxPercent > 0 ? (
              <p className="mt-1 text-[11px] text-[#9b97ac]">
                {locale === "ar" ? `${settings.taxLabelAr} ${settings.taxPercent}% تُضاف عند إتمام الطلب.` : `${settings.taxLabelEn} ${settings.taxPercent}% added at checkout.`}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <Link href={`/checkout?product=${product.slug}`} className="btn-gold flex-1">
                {t("buy_now")} <span aria-hidden="true">←</span>
              </Link>
              <WishlistButton slug={product.slug} label={t("add_to_wishlist")} />
            </div>
            <Link href={`/agents?agent=sales&product=${product.slug}`} className="btn-ghost mt-2.5 w-full text-[12px]">
              {locale === "ar" ? "اسأل مستشار المبيعات عن هذا المنتج" : "Ask the sales advisor about this product"}
            </Link>
            <ul className="mt-4 space-y-1.5 text-[12px] text-[#a8a4b8]">
              <li>
                <span aria-hidden="true" className="me-1.5 text-[#d9b26a]">
                  ✓
                </span>
                {locale === "ar" ? "روابط تحميل آمنة ومؤقتة تُسلَّم بعد تأكيد الدفع." : "Secure, expiring download links issued after payment confirmation."}
              </li>
              <li>
                <span aria-hidden="true" className="me-1.5 text-[#d9b26a]">
                  ✓
                </span>
                {locale === "ar" ? `حد التحميل ${product.downloadLimit} مرات لكل نسخة مشتراة.` : `Up to ${product.downloadLimit} downloads per licence.`}
              </li>
              <li>
                <span aria-hidden="true" className="me-1.5 text-[#d9b26a]">
                  ✓
                </span>
                <Link href="/refunds" className="underline decoration-[rgba(217,178,106,0.4)] underline-offset-2">
                  {locale === "ar" ? `استرجاع خلال ${settings.refundWindowDays} يومًا وفق السياسة.` : `Refund within ${settings.refundWindowDays} days per policy.`}
                </Link>
              </li>
            </ul>
          </div>

          <div className="mt-5">
            <h2 className="font-display text-lg text-[#f4efe3]">{t("included")}</h2>
            <ul className="mt-2 grid gap-1.5 text-[13px] text-[#bab5c8] sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-0.5 text-[#d9b26a]">
                    ✦
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.5fr_0.5fr]">
        <article className="prose-luxe">
          <h2 className="font-display text-2xl text-[#f6f1e3]">{locale === "ar" ? "عن هذا المنتج" : "About this product"}</h2>
          {description.split("\n").filter(Boolean).map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
          {product.tags.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {product.tags.map((tag) => (
                <span key={tag} className="chip">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}

          <h2 className="font-display text-2xl text-[#f6f1e3]">{t("reviews")}</h2>
          {reviews.length === 0 ? (
            <p className="text-[13px] text-[#a09db3]">
              {locale === "ar" ? "لا توجد مراجعات منشورة بعد لهذا المنتج." : "No published reviews for this product yet."}
            </p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className="glass rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] text-[#f0ecdf]">{review.authorName}</p>
                    <StarRating value={review.rating} />
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[#b3aec0]">{review.body}</p>
                  <p className="mt-1 text-[10.5px] text-[#807c91]">{formatDate(review.createdAt, locale)}</p>
                </li>
              ))}
            </ul>
          )}
        </article>

        <aside className="space-y-4">
          <div className="glass rounded-2xl p-5">
            <h3 className="font-display text-lg text-[#f4efe3]">{t("license")}</h3>
            <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-[#a9a4b8]">
              <li>{locale === "ar" ? "ترخيص شخصي غير قابل للتحويل، مع إمكانية ترقية تجارية عند الطلب." : "Personal, non-transferable licence with optional commercial upgrade."}</li>
              <li>{locale === "ar" ? "يُمنع إعادة البيع أو النشر العام للملفات الأصلية." : "Resale or public redistribution of source files is not permitted."}</li>
              <li>{locale === "ar" ? "الملف يُسلَّم بصيغة رقمية مع شهادة ترخيص باسم المشتري." : "Delivered digitally with a licence certificate in the buyer's name."}</li>
              <li>
                <a href={`mailto:${settings.supportEmail}`} className="text-[#e6d6ae] hover:underline" dir="ltr">
                  {settings.supportEmail}
                </a>
              </li>
            </ul>
          </div>
          <div className="glass rounded-2xl p-5">
            <h3 className="font-display text-lg text-[#f4efe3]">{locale === "ar" ? "طريقة الاستلام" : "How you receive it"}</h3>
            <ol className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-[#a9a4b8]">
              <li>{locale === "ar" ? "١. اختر طريقة الدفع وأكمل العملية." : "1. Choose your payment method and complete checkout."}</li>
              <li>{locale === "ar" ? "٢. يؤكد النظام الدفع عبر البوابة أو الـ Webhook." : "2. The gateway or webhook confirms payment."}</li>
              <li>{locale === "ar" ? "٣. تظهر روابط التحميل والفارورة في حسابك فورًا." : "3. Download links and your invoice appear immediately."}</li>
            </ol>
          </div>
        </aside>
      </div>

      {related.length ? (
        <section className="mt-14">
          <h2 className="mb-5 font-display text-2xl text-[#f6f1e3]">{locale === "ar" ? "اختيارات مشابهة" : "You may also like"}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <ProductCard
                key={item.id}
                product={item}
                locale={locale}
                currency={currency}
                labels={{ details: t("details"), save: t("add_to_wishlist") }}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
