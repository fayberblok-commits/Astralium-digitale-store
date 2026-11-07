import type { Metadata } from "next";
import Link from "next/link";
// Phase 1 upgrade (F2): the shop renders the resolved catalog
// (database-first; file catalog is the seed/fallback — lib/catalog.ts).
import { getStorefrontProducts } from "../../../lib/catalog";
import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import { formatPrice } from "../../../lib/currency";
import CatalogClient from "../../../components/CatalogClient";
import Cover from "../../../components/Cover";
import { ExpressBuyButton } from "../../../components/Buttons";
import { INSIDE_DESIGNS_DATA_URI } from "../../../assets/inside-designs";
import { INSIDE_SHOPIFY_DATA_URI } from "../../../assets/inside-shopify";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.shop_t, description: dict.hero_sub };
}

/** LED edge-bar colours for the gallery rows — the owner's cycle
 *  palette (green → red → yellow → orange → gold), one per row. */
const EDGE_COLORS = ["#22c55e", "#ef4444", "#facc15", "#f97316", "#efc65e"];

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  const products = await getStorefrontProducts();
  // Design G (Royal Long Gallery): the cinematic hero is the Designs
  // book — the gallery's most luxurious — falling back to the
  // highest-priced product if it ever leaves the catalog.
  const designs =
    products.find((p) => p.id === "p-4-luxury-classic-garment-designs") ??
    products.reduce((a, b) => (b.priceUSD > a.priceUSD ? b : a), products[0]);

  return (
    <>
      {/* Design G: the LED page frame + side strips (decorative,
          fixed, pointer-events disabled — see globals.css). */}
      <div className="led-page-frame" aria-hidden="true" />
      <div className="led-strip led-strip-l" aria-hidden="true" />
      <div className="led-strip led-strip-r" aria-hidden="true" />

      <h1 style={{ marginTop: 28 }}>{dict.shop_t}</h1>

      {/* ── G1 · cinematic hero: the Designs book, huge real cover ── */}
      <p className="gal-kicker"><span aria-hidden="true">✦</span> {dict.feat_collection}</p>
      <section className="gal-hero">
        <div className="gal-hero-cover">
          <Cover title={designs.title} category={designs.category} hue={designs.hue} size="lg" id={designs.id} />
        </div>
        <h2>{designs.title}</h2>
        <p className="gal-hero-price">{formatPrice(designs.priceUSD, currency, locale)}</p>
        <div className="gal-hero-btns">
          <ExpressBuyButton
            item={{
              id: designs.id, kind: "product", slug: designs.slug,
              title: designs.title, priceUSD: designs.priceUSD, hue: designs.hue,
            }}
            locale={locale}
            label={dict.buy_now}
            className="btn btn-grad btn-lg"
          />
          <Link href={`/${locale}/product/${designs.slug}`} className="btn btn-lg">
            {dict.look_inside}
          </Link>
        </div>
      </section>

      <div className="gal-divider" aria-hidden="true" />

      {/* ── G2 · a look inside: real pages from inside the books ── */}
      <section className="section">
        <h2>{dict.gallery_inside_t}</h2>
        <div className="gal-inside-grid">
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={INSIDE_SHOPIFY_DATA_URI} alt="" width={640} height={905} loading="lazy" />
          </figure>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={INSIDE_DESIGNS_DATA_URI} alt="" width={640} height={905} loading="lazy" />
          </figure>
        </div>
        <p className="gal-caption">{dict.gallery_inside_d}</p>
      </section>

      {/* ── G3 · all the books: list rows with LED edge bars ── */}
      <section className="section">
        <h2>{dict.gallery_all_t}</h2>
        <div className="gal-rows">
          {products.map((p, i) => {
            const edge = EDGE_COLORS[i % EDGE_COLORS.length];
            return (
              <article key={p.id} className="gal-row">
                <span
                  className="gal-edge"
                  aria-hidden="true"
                  style={{ background: edge, boxShadow: `0 0 12px ${edge}` }}
                />
                <Link href={`/${locale}/product/${p.slug}`} className="gal-row-thumb" aria-label={p.title}>
                  <Cover title={p.title} category={p.category} hue={p.hue} size="sm" id={p.id} />
                </Link>
                <div className="gal-row-meta">
                  <Link href={`/${locale}/product/${p.slug}`} className="gal-row-title">{p.title}</Link>
                  <span className="gal-row-price">{formatPrice(p.priceUSD, currency, locale)}</span>
                </div>
                <ExpressBuyButton
                  item={{
                    id: p.id, kind: "product", slug: p.slug,
                    title: p.title, priceUSD: p.priceUSD, hue: p.hue,
                  }}
                  locale={locale}
                  label={dict.buy_now}
                  className="btn btn-grad"
                />
              </article>
            );
          })}
        </div>
      </section>

      {/* ── G4 · why Astralium: three feature cards ── */}
      <section className="section">
        <h2>{dict.gallery_why_t}</h2>
        <div className="gal-feats">
          <article className="gal-feat">
            <span className="gal-feat-icon" aria-hidden="true">🔒</span>
            <h3>{dict.trust_secure}</h3>
            <p>{dict.checkout_secure_note}</p>
          </article>
          <article className="gal-feat">
            <span className="gal-feat-icon" aria-hidden="true">⚡</span>
            <h3>{dict.trust_instant}</h3>
            <p>{dict.how3d}</p>
          </article>
          <article className="gal-feat">
            <span className="gal-feat-icon" aria-hidden="true">🌍</span>
            <h3>{dict.trust_global}</h3>
            <p>{dict.gallery_global_d}</p>
          </article>
        </div>
      </section>

      {/* ── G5 · how your books reach you: three numbered steps ── */}
      <section className="section">
        <h2>{dict.sec_how}</h2>
        <div className="steps gal-steps">
          {[
            { t: dict.how1t, d: dict.how1d },
            { t: dict.how2t, d: dict.how2d },
            { t: dict.how3t, d: dict.how3d },
          ].map((s, i) => (
            <div key={i} className="step">
              <span className="gal-step-num">{i + 1}</span>
              <h3>{s.t}</h3>
              <p className="muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The searchable catalog grid, unchanged below the gallery. */}
      <CatalogClient products={products} locale={locale} dict={dict} currency={currency} initialQuery={q ?? ""} />
    </>
  );
}
