import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import { getStorefrontProducts } from "../../../lib/catalog";
import AccountClient from "../../../components/AccountClient";

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  const products = await getStorefrontProducts(locale);
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.account_t}</h1>
      <AccountClient locale={locale} dict={dict} currency={currency} products={products} />
    </>
  );
}
