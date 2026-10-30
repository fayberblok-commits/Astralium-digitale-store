import type { Metadata } from "next";
import { PRODUCTS } from "../../../data/products";
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
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.shop_t}</h1>
      <CatalogClient products={PRODUCTS} locale={locale} dict={dict} currency={currency} initialQuery={q ?? ""} />
    </>
  );
}
