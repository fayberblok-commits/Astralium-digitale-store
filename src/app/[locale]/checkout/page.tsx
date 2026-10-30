import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import CheckoutClient from "../../../components/CheckoutClient";

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.checkout_t}</h1>
      <CheckoutClient locale={locale} dict={dict} currency={currency} />
    </>
  );
}
