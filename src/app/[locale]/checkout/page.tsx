import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import { channelAvailability } from "../../../services/delivery";
import CheckoutClient from "../../../components/CheckoutClient";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  // Delivery-channel choice: only channels whose flag is ON and whose
  // provider is configured are offered; email is always the default.
  const availability = await channelAvailability();
  const channels = availability.map((c) => ({ key: c.key, available: c.available }));
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.checkout_t}</h1>
      <CheckoutClient locale={locale} dict={dict} currency={currency} channels={channels} />
    </>
  );
}
