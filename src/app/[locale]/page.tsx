import Link from "next/link";
import { CATEGORIES, PRODUCTS, BUNDLES, TESTIMONIALS, FAQS, bundleSavings } from "../../data/products";
import { getDictionary } from "../../i18n/dictionaries";
import { currentCurrency } from "../../lib/server";
import { formatPrice } from "../../lib/currency";
import ProductCard, { Stars } from "../../components/ProductCard";
import NewsletterForm from "../../components/NewsletterForm";
import { AddToCartButton } from "../../components/Buttons";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);

  const bestsellers = PRODUCTS.filter((p) => p.badge === "bestseller");
  const newReleases = [...PRODUCTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 4);
  const hero = PRODUCTS[0];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">{dict.hero_kicker}</p>
        <h1>{dict.hero_title}</h1>
        <p>{dict.hero_sub}</p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <Link href={`/${locale}/shop`} className="btn btn-primary btn-lg">{dict.hero_cta}</Link>
          <Link href={`/${locale}/product/${hero.slug}`} className="btn btn-lg">{dict.hero_cta2}</Link>
        </div>
        <div className="trust-row" aria-label="Trust">
          <span className="trust-badge">🔒 {dict.trust_secure}</span>
          <span className="trust-badge">⚡ {dict.trust_instant}</span>
          <span className="trust-badge">🌍 {dict.trust_global}</span>
          <span className="trust-badge">🛡️ {dict.trust_guarantee}</span>
        </div>
      </section>

      <section className="section">
        <h2>{dict.sec_categories}</h2>
        <div className="cat-grid">
          {CATEGORIES.map((c) => (
            <Link key={c.id} href={`/${locale}/shop`} className="cat-tile">
              <span aria-hidden="true">{c.icon}</span>
              {dict[`cat_${c.id}`] ?? c.id}
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>{dict.sec_bestsellers}</h2>
        <div className="grid">
          {bestsellers.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} dict={dict} currency={currency} />
          ))}
        </div>
      </section>

      <section className="section">
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

      <section className="section">
        <h2>{dict.sec_new}</h2>
        <div className="grid">
          {newReleases.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} dict={dict} currency={currency} />
          ))}
        </div>
      </section>

      <section className="section">
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

      <section className="section guarantee">
        <h2>{dict.guarantee_t}</h2>
        <p className="muted" style={{ maxWidth: 620, margin: "0 auto" }}>{dict.guarantee_d}</p>
      </section>

      <section className="section">
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

      <section className="section faq">
        <h2>{dict.sec_faq}</h2>
        {FAQS.map((f, i) => (
          <details key={i}>
            <summary>{f.q}</summary>
            <p className="muted">{f.a}</p>
          </details>
        ))}
      </section>

      <section className="section newsletter">
        <h2>{dict.newsletter_t}</h2>
        <p className="muted">{dict.newsletter_d}</p>
        <NewsletterForm dict={dict} />
      </section>
    </>
  );
}
