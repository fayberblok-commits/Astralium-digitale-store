import { getDictionary } from "../../../i18n/dictionaries";
import { currentCurrency } from "../../../lib/server";
import { channelAvailability } from "../../../services/delivery";
import { getFlag } from "../../../lib/flags";
import { listFlashSales, resolveFlashPrices } from "../../../lib/flash-sales";
import { PRODUCTS, getProductById } from "../../../data/products";
import { resolveBundle } from "../../../lib/bundles";
import { parseExpressId } from "../../../lib/express";
import { paypalClientId } from "../../../lib/paypal";
import type { CartItem } from "../../../lib/store";
import CheckoutClient from "../../../components/CheckoutClient";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ express?: string | string[] }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
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
  // Express intent (owner fix, 2026-11): BUY NOW routes here with
  // ?express=<id>; the checkout then contains ONLY that item and the
  // cart is never read into it. Resolved with the SAME catalog/bundle
  // functions /api/checkout prices from, so display and charge agree.
  // An unknown id simply falls back to the normal cart checkout.
  let expressItem: CartItem | null = null;
  const expressId = parseExpressId(sp.express);
  if (expressId) {
    const product = getProductById(expressId);
    if (product) {
      expressItem = {
        id: product.id, kind: "product", slug: product.slug, title: product.title,
        priceUSD: product.priceUSD, hue: product.hue,
      };
    } else {
      const bundle = await resolveBundle(expressId);
      if (bundle) {
        expressItem = {
          id: bundle.id, kind: "bundle", slug: bundle.slug, title: bundle.title,
          priceUSD: bundle.priceUSD, hue: bundle.hue, productIds: bundle.productIds,
        };
      }
    }
  }
  return (
    <>
      {/* 2026-11 redesign: the mockups' centred checkout title with
          its "last step" eyebrow. */}
      <p className="eyebrow lux-kicker"><span className="gem" aria-hidden="true">✦</span> {dict.checkout_kicker}</p>
      <h1 className="lux-title">{dict.checkout_t}</h1>
      <CheckoutClient
        locale={locale}
        dict={dict}
        currency={currency}
        channels={channels}
        features={features}
        flashPrices={flashPrices}
        paypalClientId={features.paypalConfigured ? paypalClientId() : null}
        expressItem={expressItem}
      />
    </>
  );
}
