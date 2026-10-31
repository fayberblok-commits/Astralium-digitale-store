import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import { channelAvailability } from "../../../services/delivery";
import { getFlag } from "../../../lib/flags";
import { listFlashSales, resolveFlashPrices } from "../../../lib/flash-sales";
import { PRODUCTS, getProductById } from "../../../data/products";
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

  // Phase 4: feature availability computed server-side. Express buttons
  // render ONLY when the express flag is on AND the provider keys exist
  // (feature 16) — never as dead buttons. Flash prices are the
  // server-computed campaign prices used for display + totals here.
  const [flashOn, giftsOn, loyaltyOn, expressOn] = await Promise.all([
    getFlag("flash_sales"), getFlag("gifts"), getFlag("loyalty"), getFlag("express_pay"),
  ]);
  let flashPrices: Record<string, number> = {};
  if (flashOn) {
    const prices = resolveFlashPrices(await listFlashSales(), PRODUCTS.map((p) => p.id), getProductById);
    flashPrices = Object.fromEntries([...prices.values()].map((fp) => [fp.productId, fp.priceUSD]));
  }
  const features = {
    gifts: giftsOn,
    loyalty: loyaltyOn,
    expressStripe: expressOn && Boolean(process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
    expressPaypal: expressOn && Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  };
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.checkout_t}</h1>
      <CheckoutClient locale={locale} dict={dict} currency={currency} channels={channels} features={features} flashPrices={flashPrices} />
    </>
  );
}
