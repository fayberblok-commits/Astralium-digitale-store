import type { ReactNode } from "react";
import Link from "next/link";
import { CATEGORIES, TESTIMONIALS, FAQS, bundleSavings } from "../../data/products";
import { storefrontBundles } from "../../lib/bundles";
// Phase 1 upgrade (F2): the homepage renders the resolved catalog
// (database-first; file catalog is the seed/fallback — lib/catalog.ts).
import { getStorefrontProducts } from "../../lib/catalog";
// Phase 3 upgrade: section ORDER and VISIBILITY are owner-controlled
// (admin panel → /api/admin/home-sections → lib/home-settings).
import { getHomeSections, visibleHomeSections, type HomeSectionId } from "../../lib/home-settings";
import { getHeroText, heroTextFor } from "../../lib/design";
import { getDictionary } from "../../i18n/dictionaries";
import { currentCurrency } from "../../lib/server";
import { formatPrice } from "../../lib/currency";
import { HERO_ART_DATA_URI } from "../../assets/hero-art";
import ProductCard, { Stars } from "../../components/ProductCard";
import Cover from "../../components/Cover";
import HeroScene, { HeroStats } from "../../components/HeroScene";
import Marquee from "../../components/Marquee";
import ScrollReveal from "../../components/ScrollReveal";
import NewsletterForm from "../../components/NewsletterForm";
import { AddToCartButton, ExpressPayPalButton } from "../../components/Buttons";
import SocialProof from "../../components/SocialProof";
import AbBeacon from "../../components/AbBeacon";
import { cookies } from "next/headers";
import { getFlag } from "../../lib/flags";
import { AB_SLOT_HERO, AB_VISITOR_COOKIE, getAbConfig, heroHeadlineFor, runningExperimentForSlot } from "../../lib/ab";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);

  // A/B tests (Phase 5, feature 23): the hero headline is the designated
  // slot. Bucketing is deterministic per anonymous visitor cookie; with
  // the flag off (or no running experiment / no cookie yet) the
  // dictionary headline renders exactly as before.
  // Phase 4 upgrade: the owner's hero-text override (Manager's Office)
  // sits between the dictionary and a running experiment — an active
  // experiment still wins, so tests keep measuring what they measure.
  const heroOverride = heroTextFor(await getHeroText(), locale, {
    hero_title: dict.hero_title, hero_sub: dict.hero_sub,
  });
  const abOn = await getFlag("ab_tests");
  let heroTitle = heroOverride.title;
  if (abOn) {
    const jar = await cookies();
    const visitorId = jar.get(AB_VISITOR_COOKIE)?.value ?? null;
    const exp = runningExperimentForSlot(await getAbConfig(), AB_SLOT_HERO);
    heroTitle = heroHeadlineFor(exp, visitorId) ?? heroOverride.title;
  }

  // Owner-managed bundles (DB/.data) replace the catalog bundles once
  // the owner creates one; otherwise the catalog bundles render as before.
  const BUNDLES = await storefrontBundles();
  const PRODUCTS = await getStorefrontProducts();
  const bestsellers = PRODUCTS.filter((p) => p.badge === "bestseller");
  const newReleases = [...PRODUCTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 4);
  const hero = PRODUCTS[0];
  // 2026-11 redesign: the featured band's product — first bestseller,
  // else the catalog's lead product (real catalog data, as before).
  const featured = bestsellers[0] ?? hero;
  // The PayPal-branded button renders only when PayPal is actually
  // configured — the codebase's standing no-dead-buttons rule.
  const paypalConfigured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  const categoryCounts = new Map<string, number>();
  for (const p of PRODUCTS) categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);

  const sections: Record<HomeSectionId, ReactNode> = {
    hero: (
      <section className="hero">
        <div className="hero-frame hero-split">
          {/* Phase 2 upgrade: animated scene (aurora + canvas stars +
              floating shapes) behind the copy. All decorative layers
              are CLS-safe and honour reduced-motion / the owner's
              toggle. 2026-11 redesign: the frame is now the approved
              mockups' two-column composition — copy on one side, the
              arch-framed Astralium artwork with the lead product's
              cover overlapping it on the other. */}
          <HeroScene />
          <div className="hero-copy">
            <p className="hero-kicker">{dict.hero_kicker}</p>
            <h1>{heroTitle}</h1>
            <p>{heroOverride.sub}</p>
            <div className="btn-row hero-btns">
              <Link href={`/${locale}/shop`} className="btn btn-primary btn-lg">{dict.hero_cta}</Link>
              <Link href={`/${locale}/product/${hero.slug}`} className="btn btn-lg">{dict.hero_cta2}</Link>
            </div>
            {/* Owner fix (2026-11): on phones the hero used to fill the
                whole first screen with the books far below. This jump
                (mobile-only, CSS-gated) lands the reader directly on
                the featured book + catalog sections. */}
            <p className="hero-jump-wrap">
              <a href="#books" className="hero-jump">{dict.hero_browse_books} <span aria-hidden="true">↓</span></a>
            </p>
            <p className="hero-trust">
              {dict.trust_instant} <span aria-hidden="true">◆</span> {dict.trust_guarantee} <span aria-hidden="true">◆</span> {dict.trust_secure}
            </p>
            <HeroStats
              stats={[
                { value: PRODUCTS.length, label: dict.hero_stat_products },
                { value: 40, label: dict.hero_stat_languages },
                {
                  value: Math.round((PRODUCTS.reduce((s, p) => s + p.rating, 0) / Math.max(1, PRODUCTS.length)) * 10) / 10,
                  decimals: 1,
                  suffix: " ★",
                  label: dict.hero_stat_rating,
                },
                { value: 14, label: dict.hero_stat_guarantee },
              ]}
            />
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-arch">
              {/* Owner-approved artwork (2026-11): generated for the
                  redesign, shipped in public/brand. Decorative — the
                  adjacent copy carries all meaning. Plain <img> by
                  design: the codebase self-hosts all imagery and does
                  not use the next/image optimizer anywhere. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={HERO_ART_DATA_URI} alt="" width={859} height={1000} />
            </div>
            <div className="hero-mini-cover">
              <Cover title={hero.title} category={hero.category} hue={hero.hue} size="sm" />
            </div>
          </div>
        </div>
      </section>
    ),
    trust: (
      <section className="trust-section" aria-label="Trust">
        <div className="trust-row">
          <span className="trust-item">{dict.trust_secure}</span>
          <span className="trust-item">{dict.trust_instant}</span>
          <span className="trust-item">{dict.trust_global}</span>
          <span className="trust-item">{dict.trust_guarantee}</span>
        </div>
        <Marquee
          items={[
            dict.trust_secure,
            dict.trust_instant,
            dict.trust_global,
            dict.trust_guarantee,
            ...TESTIMONIALS.map((t) => `${t.name} · ${"★".repeat(Math.round(t.rating))} · ${t.country}`),
          ]}
        />
      </section>
    ),
    featured: (
      <section className="section" id="books" data-reveal>
        {/* 2026-11 redesign: "The Featured Book" band from the approved
            mockups — one real catalog product, large cover, price, and
            the stacked BUY NOW / ADD TO CART / PayPal actions. Its
            borders carry the owner's animated colour cycle on the
            astralium-noir palette (.cycle-line). The bestsellers grid
            follows unchanged below it. */}
        <div className="sec-head">
          <p className="eyebrow"><span className="gem" aria-hidden="true">✦</span> {dict.feat_collection}</p>
          <h2>{dict.sec_featured_book}</h2>
        </div>
        <article className="feat-band cycle-line">
          <Link href={`/${locale}/product/${featured.slug}`} className="feat-cover" aria-label={featured.title}>
            <Cover title={featured.title} category={featured.category} hue={featured.hue} size="lg" />
          </Link>
          <div className="feat-mid">
            <h3>{featured.title}</h3>
            <p className="muted">{featured.subtitle}</p>
            <p className="feat-price">
              <strong>{formatPrice(featured.priceUSD, currency, locale)}</strong>
              {featured.compareAtUSD && <s>{formatPrice(featured.compareAtUSD, currency, locale)}</s>}
              <small>{dict.one_time_note} · {featured.formats.map((f) => f.format).join(" · ")}</small>
            </p>
          </div>
          <div className="feat-actions">
            <AddToCartButton
              stack
              big
              locale={locale}
              addLabel={dict.add_to_cart}
              inCartLabel={dict.in_cart}
              buyLabel={dict.buy_now}
              item={{
                id: featured.id, kind: "product", slug: featured.slug,
                title: featured.title, priceUSD: featured.priceUSD, hue: featured.hue,
              }}
            />
            {paypalConfigured && (
              <ExpressPayPalButton
                big
                locale={locale}
                item={{
                  id: featured.id, kind: "product", slug: featured.slug,
                  title: featured.title, priceUSD: featured.priceUSD, hue: featured.hue,
                }}
              />
            )}
          </div>
        </article>
        <h2 className="feat-grid-title">{dict.sec_bestsellers}</h2>
        <div className="grid">
          {bestsellers.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} dict={dict} currency={currency} />
          ))}
        </div>
      </section>
    ),
    categories: (
      <section className="section" data-reveal>
        <h2>{dict.sec_categories}</h2>
        <div className="cat-grid">
          {CATEGORIES.map((c) => (
            <Link key={c.id} href={`/${locale}/shop`} className="cat-tile">
              <span aria-hidden="true">{c.icon}</span>
              {dict[`cat_${c.id}`] ?? c.id}
              <small className="cat-count">
                {dict.cat_products.replace("{n}", String(categoryCounts.get(c.id) ?? 0))}
              </small>
            </Link>
          ))}
        </div>
      </section>
    ),
    bundles: (
      <section className="section band-dark" data-reveal>
        <h2>{dict.sec_bundles}</h2>
        <div className="grid">
          {BUNDLES.map((b) => (
            <article key={b.id} className="bundle-card">
              <h3>{b.title}</h3>
              <p className="muted">{b.description}</p>
              <p>
                <strong>{formatPrice(b.priceUSD, currency, locale)}</strong>{" "}
                <span className="ok-text">
                  {dict.bundle_save} {formatPrice(bundleSavings(b), currency, locale)}
                </span>
              </p>
              <AddToCartButton
                locale={locale}
                addLabel={dict.add_to_cart}
                inCartLabel={dict.in_cart}
                item={{
                  id: b.id, kind: "bundle", slug: b.slug, title: b.title,
                  priceUSD: b.priceUSD, hue: b.hue, productIds: b.productIds,
                }}
              />
            </article>
          ))}
        </div>
      </section>
    ),
    new: (
      <section className="section" data-reveal>
        <h2>{dict.sec_new}</h2>
        <div className="grid">
          {newReleases.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} dict={dict} currency={currency} />
          ))}
        </div>
      </section>
    ),
    how: (
      <section className="section" data-reveal>
        <h2>{dict.sec_how}</h2>
        <div className="steps">
          {[
            { t: dict.how1t, d: dict.how1d },
            { t: dict.how2t, d: dict.how2d },
            { t: dict.how3t, d: dict.how3d },
          ].map((s, i) => (
            <div key={i} className="step">
              <span className="step-num">{i + 1}</span>
              <h3>{s.t}</h3>
              <p className="muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    ),
    guarantee: (
      <section className="section guarantee" data-reveal>
        <h2>{dict.guarantee_t}</h2>
        <p className="muted" style={{ maxWidth: 620, margin: "0 auto" }}>{dict.guarantee_d}</p>
      </section>
    ),
    testimonials: (
      <section className="section" data-reveal>
        <h2>{dict.sec_testimonials}</h2>
        <div className="grid">
          {TESTIMONIALS.map((t, i) => (
            <article key={i} className="testimonial">
              <blockquote>“{t.quote}”</blockquote>
              <p>
                <Stars rating={t.rating} /> <strong>{t.name}</strong> · {t.country}
              </p>
            </article>
          ))}
        </div>
      </section>
    ),
    faq: (
      <section className="section faq" data-reveal>
        <h2>{dict.sec_faq}</h2>
        {FAQS.map((f, i) => (
          <details key={i}>
            <summary>{f.q}</summary>
            <p className="muted">{f.a}</p>
          </details>
        ))}
      </section>
    ),
    newsletter: (
      <section className="section newsletter" data-reveal>
        <h2>{dict.newsletter_t}</h2>
        <p className="muted">{dict.newsletter_d}</p>
        <NewsletterForm dict={dict} />
      </section>
    ),
  };

  const layout = await getHomeSections();
  const visible = visibleHomeSections(layout);

  return (
    <>
      {visible.map((id) => (
        <div key={id} data-home-section={id} style={{ display: "contents" }}>
          {sections[id]}
        </div>
      ))}

      {/* Phase 5, feature 24: real-data social proof (renders nothing
          when the flag is off or no real orders/reviews exist yet). */}
      <SocialProof locale={locale} dict={dict} />
      {abOn ? <AbBeacon mode="exposure" /> : null}
      <ScrollReveal />
    </>
  );
}
