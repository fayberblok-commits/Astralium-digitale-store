import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PRODUCTS, getProductBySlug, relatedProducts, BUNDLES, bundleProducts, bundleSavings,
} from "../../../../data/products";
import { getDictionary } from "../../../../i18n/dictionaries";
import { LOCALE_CODES } from "../../../../i18n/locales";
import { currentCurrency, siteUrl } from "../../../../lib/server";
import { formatPrice } from "../../../../lib/currency";
import Cover from "../../../../components/Cover";
import ProductCard, { Stars } from "../../../../components/ProductCard";
import { AddToCartButton } from "../../../../components/Buttons";
import RecommendationsRail from "../../../../components/RecommendationsRail";
import ReviewsSection from "../../../../components/ReviewsSection";
import RecordView from "../../../../components/RecordView";
import ProductCommerce from "../../../../components/ProductCommerce";
import { isAudioProduct } from "../../../../lib/preview";
import { getFlag } from "../../../../lib/flags";
import { aggregateReviews, listReviews } from "../../../../lib/reviews";
import { buildBreadcrumbJsonLd, buildProductJsonLd } from "../../../../lib/seo";

export function generateStaticParams() {
  return LOCALE_CODES.flatMap((locale) => PRODUCTS.map((p) => ({ locale, slug: p.slug })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return {};
  const description = product.description.slice(0, 155);
  const url = `${siteUrl()}/${locale}/product/${product.slug}`;
  return {
    title: product.title,
    description,
    alternates: { canonical: `/${locale}/product/${product.slug}` },
    // The per-product OG image comes from the opengraph-image.tsx
    // convention in this segment (Phase 5, SEO engine).
    openGraph: { title: product.title, description, type: "website", url },
    twitter: { card: "summary_large_image", title: product.title, description },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  const related = relatedProducts(product);
  const bundle = BUNDLES.find((b) => b.productIds.includes(product.id));

  const cartItem = {
    id: product.id, kind: "product" as const, slug: product.slug,
    title: product.title, priceUSD: product.priceUSD, hue: product.hue,
  };

  // JSON-LD (Phase 5, SEO engine): Product + Offer carry real catalog
  // data; AggregateRating is emitted ONLY from real APPROVED reviews
  // (Phase 3 store) — with none approved, the block is omitted instead
  // of being filled from the catalog's illustrative seed ratings.
  const approvedReviews = (await getFlag("reviews")) ? await listReviews(product.id, "approved") : [];
  const reviewAgg = aggregateReviews(approvedReviews);
  const jsonLd = buildProductJsonLd({
    product,
    locale,
    siteBase: siteUrl(),
    reviewAgg: reviewAgg.count > 0 ? reviewAgg : null,
  });
  const breadcrumbLd = buildBreadcrumbJsonLd({
    siteBase: siteUrl(),
    locale,
    trail: [
      { name: dict.nav_home, path: "" },
      { name: dict.nav_shop, path: "/shop" },
      { name: product.title, path: `/product/${product.slug}` },
    ],
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <div className="product-layout">
        <div>
          <Cover title={product.title} category={product.category} hue={product.hue} size="lg" />
        </div>
        <div>
          <p className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {dict[`cat_${product.category}`] ?? product.category}
            {product.badge ? ` · ${product.badge === "bestseller" ? dict.badge_bestseller : dict.badge_new}` : ""}
          </p>
          <h1 style={{ fontSize: "2.2rem", margin: "6px 0" }}>{product.title}</h1>
          <p className="muted" style={{ fontSize: "1.05rem" }}>{product.subtitle}</p>
          <p>
            <Stars rating={product.rating} /> {product.rating} · {product.reviewsCount} {dict.reviews}
          </p>
          <p className="price-block">
            <strong>{formatPrice(product.priceUSD, currency, locale)}</strong>
            {product.compareAtUSD && <s>{formatPrice(product.compareAtUSD, currency, locale)}</s>}
          </p>
          <AddToCartButton
            item={cartItem}
            locale={locale}
            addLabel={dict.add_to_cart}
            inCartLabel={dict.in_cart}
            buyLabel={dict.buy_now}
            big
          />
          <p className="muted">{dict.free_returns_note}</p>
          {/* Phase 4: flash-sale price/countdown, pre-order badge, PWYW
              tiers, subscription — renders only what is flag-on and
              configured for this product (server-computed state). */}
          <ProductCommerce
            product={{ id: product.id, slug: product.slug, title: product.title, priceUSD: product.priceUSD, hue: product.hue }}
            locale={locale}
            dict={dict}
            currency={currency}
          />

          <h2>{dict.includes_t}</h2>
          <ul className="includes">
            {product.includes.map((inc) => (
              <li key={inc}>{inc}</li>
            ))}
          </ul>

          <h2>{dict.formats_t}</h2>
          <table className="format-table">
            <tbody>
              {product.formats.map((f) => (
                <tr key={f.format}>
                  <td>{f.format}</td>
                  <td>{f.sizeMB >= 1000 ? `${(f.sizeMB / 1000).toFixed(1)} GB` : `${f.sizeMB} MB`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="section">
        <h2>{dict.preview_t}</h2>
        <div className="preview-box">
          <p style={{ marginTop: 0 }}>{product.preview}</p>
          {isAudioProduct(product) ? (
            <>
              <p><strong>{dict.preview_listen}</strong></p>
              <audio controls preload="none" src={`/api/preview/${product.id}`} style={{ width: "100%" }} aria-label={dict.preview_listen} />
            </>
          ) : (
            <iframe
              src={`/api/preview/${product.id}`}
              title={dict.preview_open}
              style={{ width: "100%", minHeight: 240, border: "1px solid var(--line)" }}
              loading="lazy"
            />
          )}
          <p style={{ marginBottom: 0 }}>
            <a href={`/api/preview/${product.id}`} target="_blank" rel="noreferrer" className="btn">{dict.preview_open}</a>
          </p>
        </div>
        <p className="muted" style={{ marginTop: 18 }}>{product.description}</p>

        <h3>{dict.preview_structure}</h3>
        <table className="format-table">
          <tbody>
            {product.formats.map((f) => (
              <tr key={f.format}>
                <td>{f.format}</td>
                <td>{f.sizeMB >= 1000 ? `${(f.sizeMB / 1000).toFixed(1)} GB` : `${f.sizeMB} MB`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {bundle && (
        <section className="section panel">
          <h2>{dict.bundle_upsell_t}: {bundle.title}</h2>
          <p className="muted">
            {bundleProducts(bundle).map((p) => p.title).join(" · ")}
          </p>
          <p>
            <strong>{formatPrice(bundle.priceUSD, currency, locale)}</strong>{" "}
            <span className="ok-text">{dict.bundle_save} {formatPrice(bundleSavings(bundle), currency, locale)}</span>
          </p>
          <AddToCartButton
            locale={locale}
            addLabel={dict.add_to_cart}
            inCartLabel={dict.in_cart}
            item={{
              id: bundle.id, kind: "bundle", slug: bundle.slug, title: bundle.title,
              priceUSD: bundle.priceUSD, hue: bundle.hue, productIds: bundle.productIds,
            }}
          />
        </section>
      )}

      <section className="section">
        <h2>{dict.related_t}</h2>
        <div className="grid">
          {related.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} dict={dict} currency={currency} />
          ))}
        </div>
      </section>

      <ReviewsSection productId={product.id} productTitle={product.title} dict={dict} />

      <RecommendationsRail
        locale={locale}
        dict={dict}
        currency={currency}
        productId={product.id}
        excludeIds={[product.id, ...related.map((p) => p.id)]}
      />
      <RecordView slug={product.slug} productId={product.id} />

      <div className="sticky-buybar">
        <span className="sb-title">{product.title}</span>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <strong>{formatPrice(product.priceUSD, currency, locale)}</strong>
          <AddToCartButton
            item={cartItem}
            locale={locale}
            addLabel={dict.add_to_cart}
            inCartLabel={dict.in_cart}
            buyLabel={dict.buy_now}
          />
          <Link href={`/${locale}/cart`} className="btn btn-ghost">{dict.nav_cart}</Link>
        </span>
      </div>
    </>
  );
}
