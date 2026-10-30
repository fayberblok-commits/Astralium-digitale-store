import { notFound } from "next/navigation";
import { getDictionary } from "../../../../i18n/dictionaries";
import { isLocale } from "../../../../i18n/locales";
import { currentCurrency } from "../../../../lib/server";
import { formatPrice } from "../../../../lib/currency";
import { parseShareItems } from "../../../../lib/share";
import Cover from "../../../../components/Cover";
import Link from "next/link";

/**
 * Shared wishlist (Phase 3, feature 8): a read-only list decoded from
 * the URL (?items=slug,slug,…). Every slug is validated against the
 * catalog server-side; unknown slugs are silently dropped.
 */
export const dynamic = "force-dynamic";

export default async function SharedWishlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ items?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  const products = parseShareItems(sp.items);

  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.shared_wishlist_t}</h1>
      {products.length === 0 ? (
        <p className="empty-note">{dict.wishlist_empty}</p>
      ) : (
        <div className="grid">
          {products.map((p) => (
            <article key={p.id} className="card">
              <Link href={`/${locale}/product/${p.slug}`}>
                <Cover title={p.title} category={p.category} hue={p.hue} />
              </Link>
              <div className="card-body">
                <Link href={`/${locale}/product/${p.slug}`} className="card-title">{p.title}</Link>
                <p className="card-price">{formatPrice(p.priceUSD, currency, locale)}</p>
                <Link href={`/${locale}/product/${p.slug}`} className="btn">{dict.view_product}</Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
