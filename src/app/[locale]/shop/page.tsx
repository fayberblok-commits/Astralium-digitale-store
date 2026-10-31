import type { Metadata } from "next";
// Phase 1 upgrade (F2): the shop renders the resolved catalog
// (database-first; file catalog is the seed/fallback — lib/catalog.ts).
import { getStorefrontProducts } from "../../../lib/catalog";
import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import CatalogClient from "../../../components/CatalogClient";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return { title: dict.shop_t, description: dict.hero_sub };
}

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
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.shop_t}</h1>
      <CatalogClient products={products} locale={locale} dict={dict} currency={currency} initialQuery={q ?? ""} />
    </>
  );
}
