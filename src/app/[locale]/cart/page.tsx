import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import CartClient from "../../../components/CartClient";
import CartRecover from "../../../components/CartRecover";

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.cart_t}</h1>
      <CartRecover dict={dict} />
      <CartClient locale={locale} dict={dict} currency={currency} />
    </>
  );
}
