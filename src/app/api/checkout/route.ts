import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getStorefrontProducts } from "../../../lib/catalog";
import { resolveBundle } from "../../../lib/bundles";
import { byoDiscount, round2 } from "../../../lib/byo";
import { getFlag } from "../../../lib/flags";
import { getOfferConfig, resolveBumps } from "../../../lib/offers";
import { applyCouponIn } from "../../../lib/coupons";
import { getCoupons } from "../../../lib/coupons-store";
import { piiConfigured, recordConsent } from "../../../lib/pii";
import { normalizePhone } from "../../../lib/phone";
import { siteUrl } from "../../../lib/server";
// Phase 4 (features 9–16)
import { countFlashSaleOrder, listFlashSales, resolveFlashPrices } from "../../../lib/flash-sales";
import { getPwywConfig, resolvePwywPrice, type PwywChoice } from "../../../lib/pwyw";
import { createGifts, validateGiftInput, type GiftInput } from "../../../lib/gifts";
import { commitSpendForOrder, previewRedemption } from "../../../lib/loyalty";
import { getReferralConfig, recordAttribution } from "../../../lib/referrals";
// Phase 5 (feature 19): fraud shield — blacklist + risk scoring + holds.
import { assessCheckout, isBlacklisted, recordFailedAttempt } from "../../../lib/fraud";
// Phase 1 upgrade: unified body reading, trusted-proxy client IP, the
// order ledger (PENDING order at initiation) and the pinned Stripe API.
import { createPendingOrder } from "../../../lib/orders";
import { STRIPE_API_VERSION } from "../../../lib/stripe";
import { getClientCountry, getClientIp, httpErrorResponse, readJsonBody } from "../../../lib/http";
// Owner fix (2026-11): checkout email is OPTIONAL (receipt/backup
// only — delivery happens on the success page), and PayPal order
// creation goes through the shared lib so the redirect flow and the
// on-page JS SDK flow build identical orders.
import { normalizeCheckoutEmail } from "../../../lib/checkout-rules";
import { buildPaypalOrderBody, createPaypalOrder, getPaypalAccessToken, paypalConfigured } from "../../../lib/paypal";

export const runtime = "nodejs";

interface CartRef { id: string; kind?: string }

const REQUIRED_ENV = [
  "STRIPE_SECRET_KEY (Stripe) — dashboard.stripe.com/apikeys",
  "or PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET (PayPal) — developer.paypal.com",
];

/**
 * Creates a REAL payment session with the configured provider.
 * Prices always come from the server-side catalog — client prices are
 * ignored. Without any provider configured this returns 503
 * PAYMENTS_NOT_CONFIGURED. It never fabricates a payment.
 */
export async function POST(req: NextRequest) {
  let body: {
    items?: CartRef[];
    email?: string;
    provider?: string;
    /** "sdk" = on-page PayPal JS SDK flow (no redirect); anything else = redirect flow. */
    mode?: string;
    coupon?: string;
    bumpProductIds?: string[];
    locale?: string;
    orderId?: string;
    delivery?: { channel?: string; phoneE164?: string; optIn?: boolean };
    // Phase 4: pwyw choices per product, gift marks, loyalty redemption, referral code
    pwyw?: Record<string, PwywChoice>;
    gifts?: GiftInput[];
    loyaltyPoints?: number;
    refCode?: string;
  } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 32 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "EMPTY_CART" }, { status: 400 });
  }
  // Email is OPTIONAL (owner fix, 2026-11): blank is fine — the book
  // is delivered on the success page; a typed email is used only for
  // the receipt/backup copy and must be well-formed. For PayPal, the
  // payer email returned at capture is stored on the order when the
  // buyer skipped this field (lib/paypal.ts fulfilPaypalOrder).
  const emailCheck = normalizeCheckoutEmail(body.email);
  if (!emailCheck.ok) {
    return NextResponse.json({ error: emailCheck.error }, { status: 400 });
  }
  const email = emailCheck.email;
  const sdkMode = body.mode === "sdk";
  const locale = body.locale && body.locale.length <= 10 ? body.locale : "en";
  const orderId = (body.orderId ?? `AST-${Date.now().toString(36).toUpperCase()}`).slice(0, 40);
  // Trusted-proxy IP only (lib/http) — raw x-forwarded-for is spoofable.
  const clientIp = getClientIp(req);

  // Fraud shield (Phase 5, feature 19): a blacklisted email is refused
  // before any payment session exists. Hash-only lookup (lib/fraud.ts).
  const fraudOn = await getFlag("fraud_shield");
  // Email-keyed fraud checks only apply when an email was provided —
  // with the optional-email flow, anonymous buyers must not share one
  // empty-string bucket (that would aggregate their velocity counts).
  if (fraudOn && email && (await isBlacklisted(email))) {
    return NextResponse.json({ error: "EMAIL_BLACKLISTED" }, { status: 403 });
  }

  // Delivery channel (Phase 2). WhatsApp requires a valid E.164 number and
  // an explicit opt-in; the consent is recorded now (subject stored only as
  // hash + AES-GCM ciphertext — see lib/pii.ts) and ONLY the hash travels
  // into Stripe metadata. Messenger/Instagram cannot be initiated by the
  // store, so the choice is recorded and fulfilled via the claim flow.
  const deliveryChannel = ["email", "whatsapp", "messenger", "instagram"].includes(body.delivery?.channel ?? "")
    ? (body.delivery!.channel as string)
    : "email";
  let deliverySubjectHash: string | undefined;
  if (deliveryChannel === "whatsapp") {
    if (body.delivery?.optIn !== true) {
      return NextResponse.json({ error: "WHATSAPP_OPTIN_REQUIRED" }, { status: 400 });
    }
    const parsed = normalizePhone(body.delivery?.phoneE164 ?? "");
    if (!parsed.ok) {
      return NextResponse.json({ error: "INVALID_PHONE" }, { status: 400 });
    }
    await recordConsent({ subject: parsed.e164, channel: "whatsapp", granted: true });
    deliverySubjectHash = createHash("sha256").update(parsed.e164).digest("hex");
  }

  // Resolve items server-side (client prices are never trusted). Bundles
  // stay a single line at the bundle price; their products are recorded
  // for fulfilment.
  // Catalog resolution is DB-first (lib/catalog): office-created
  // products live ONLY in the resolved catalog, not in the static seed
  // list — resolving against the seed alone made real products
  // unbuyable (UNKNOWN_ITEM) and priced ledger items at $0.
  const catalogProducts = await getStorefrontProducts();
  const catalogById = new Map(catalogProducts.map((p) => [p.id, p]));
  const productIds: string[] = [];
  const standaloneIds: string[] = []; // direct product items (BYO counts these)
  const lineItems: { title: string; amountUSD: number }[] = [];
  const lineProductIds: (string | null)[] = []; // aligned with lineItems (null = bundle line)
  let subtotal = 0;
  for (const ref of body.items) {
    const product = catalogById.get(ref.id);
    if (product) {
      productIds.push(product.id);
      standaloneIds.push(product.id);
      lineItems.push({ title: product.title, amountUSD: product.priceUSD });
      lineProductIds.push(product.id);
      subtotal += product.priceUSD;
      continue;
    }
    const bundle = await resolveBundle(ref.id);
    if (bundle) {
      productIds.push(...bundle.productIds);
      lineItems.push({ title: bundle.title, amountUSD: bundle.priceUSD });
      lineProductIds.push(null);
      subtotal += bundle.priceUSD;
      continue;
    }
    return NextResponse.json({ error: `UNKNOWN_ITEM:${ref.id}` }, { status: 400 });
  }

  // Phase 4 price layer — applied to standalone product lines BEFORE any
  // discount. Both features recompute prices server-side from owner
  // config + catalog; client-sent amounts are never trusted.
  const adjustLine = (productId: string, amountUSD: number) => {
    const idx = lineProductIds.indexOf(productId);
    if (idx >= 0) {
      subtotal = round2(subtotal - lineItems[idx].amountUSD + amountUSD);
      lineItems[idx] = { ...lineItems[idx], amountUSD };
    }
  };

  // Flash sales (feature 9): an active campaign's price wins for its
  // products; the cap is enforced inside resolveFlashPrices via the
  // campaign state machine (sold-out campaigns do not discount).
  let flashDiscountUSD = 0;
  const flashUnitsBySale = new Map<string, number>();
  if (await getFlag("flash_sales")) {
    const sales = await listFlashSales();
    const flashPrices = resolveFlashPrices(sales, standaloneIds, (id) => catalogById.get(id));
    for (const fp of flashPrices.values()) {
      adjustLine(fp.productId, fp.priceUSD);
      flashDiscountUSD = round2(flashDiscountUSD + (fp.fullPriceUSD - fp.priceUSD));
      flashUnitsBySale.set(fp.saleId, (flashUnitsBySale.get(fp.saleId) ?? 0) + standaloneIds.filter((id) => id === fp.productId).length);
    }
  }
  const countFlashUnits = async () => {
    for (const [saleId, units] of flashUnitsBySale) {
      await countFlashSaleOrder(saleId, orderId, units);
    }
  };

  // Pay-what-you-want / tiers (feature 13): validated against the stored
  // per-product config; below-min or unknown tiers fail the checkout.
  if (body.pwyw && Object.keys(body.pwyw).length > 0 && (await getFlag("pwyw"))) {
    const config = await getPwywConfig();
    for (const [pid, choice] of Object.entries(body.pwyw)) {
      if (!standaloneIds.includes(pid)) continue;
      const product = catalogById.get(pid);
      if (!product) continue;
      const resolved = resolvePwywPrice(config, product, choice ?? {});
      if (!resolved.ok) {
        return NextResponse.json({ error: `PWYW_${resolved.error}:${pid}` }, { status: 400 });
      }
      adjustLine(pid, resolved.priceUSD);
    }
  }

  // Gift marks (feature 10): validated now (recipient, product in cart,
  // PII encryption available); records are created once the payment
  // session exists — delivery itself only happens on the paid webhook.
  const giftInputs: GiftInput[] = Array.isArray(body.gifts) ? body.gifts : [];
  if (giftInputs.length > 0) {
    if (!(await getFlag("gifts"))) {
      return NextResponse.json({ error: "GIFTS_DISABLED" }, { status: 403 });
    }
    // A gift order needs the BUYER's email: gift records and claim
    // codes are keyed to it. This is the one flow where the otherwise
    // optional email is genuinely required.
    if (!email) {
      return NextResponse.json({ error: "EMAIL_REQUIRED_FOR_GIFTS" }, { status: 400 });
    }
    if (!piiConfigured()) {
      return NextResponse.json({ error: "PII_NOT_CONFIGURED" }, { status: 400 });
    }
    for (const gift of giftInputs) {
      if (!standaloneIds.includes(gift.productId)) {
        return NextResponse.json({ error: `GIFT_PRODUCT_NOT_IN_CART:${gift.productId}` }, { status: 400 });
      }
      const check = validateGiftInput(gift);
      if (!check.ok) {
        return NextResponse.json({ error: `GIFT_${check.error}` }, { status: 400 });
      }
    }
  }

  // Order bumps (Phase 3, feature 4): flag-gated, prices re-derived from
  // the server-side offer config — the client only names product ids.
  const bumpLines: { productId: string; title: string; priceUSD: number }[] = [];
  if (Array.isArray(body.bumpProductIds) && body.bumpProductIds.length > 0 && (await getFlag("order_bump"))) {
    const config = await getOfferConfig();
    for (const line of resolveBumps(standaloneIds, body.bumpProductIds, config)) {
      bumpLines.push({ productId: line.productId, title: line.title, priceUSD: line.priceUSD });
      productIds.push(line.productId);
      lineItems.push({ title: `${line.title} (bump −${line.discountPercent}%)`, amountUSD: line.priceUSD });
      lineProductIds.push(null);
      subtotal += line.priceUSD;
    }
  }

  // Coupon (server-side re-validation; country from CF header when present).
  // Phase 4 upgrade: evaluated against the office-managed coupon list.
  let discount = 0;
  if (body.coupon) {
    const country = req.headers.get("cf-ipcountry") ?? undefined;
    const result = applyCouponIn(await getCoupons(), body.coupon, subtotal, { isFirstOrder: true, country });
    if (result.ok) discount = result.discountUSD;
  }
  // Build-your-own bundle (Phase 3, feature 3): any 3+ distinct products
  // earn an automatic 15% on those products, server-validated here and
  // itemized separately from any coupon.
  let byoDiscountUSD = 0;
  if (await getFlag("bundles")) {
    byoDiscountUSD = byoDiscount(standaloneIds, catalogProducts).discountUSD;
  }
  const couponDiscountUSD = discount; // coupon only — BYO is itemized separately
  discount += byoDiscountUSD;

  // Loyalty redemption (feature 11): flag-gated; the ledger applies its
  // own server-side caps (balance + max % of the payable total) — the
  // requested points are only a ceiling. This step is a read-only
  // preview that prices the order; the points are COMMITTED in
  // persistOrderExtras, only once the payment session exists.
  let loyaltyRedeemUSD = 0;
  let loyaltyPointsSpent = 0;
  // Loyalty balances are keyed by email — no email, no redemption.
  if (body.loyaltyPoints && body.loyaltyPoints > 0 && email && (await getFlag("loyalty"))) {
    const redemption = await previewRedemption(email, body.loyaltyPoints, Math.max(0, subtotal - discount));
    loyaltyPointsSpent = redemption.points;
    loyaltyRedeemUSD = redemption.valueUSD;
    discount += loyaltyRedeemUSD;
  }
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  // Fraud shield (Phase 5, feature 19): risk-score this checkout from
  // server-side signals (disposable domain, email/IP velocity, amount,
  // past failures). A score at/above the owner's threshold creates a
  // pending HOLD: payment proceeds, but delivery pauses (webhook +
  // download route enforce it) until the owner reviews. Review-only —
  // the buyer is never told and nothing is auto-refunded.
  if (fraudOn && email) {
    const assessment = await assessCheckout({ orderId, email, ip: clientIp, amountUSD: total });
    if (!assessment.blocked && assessment.held) {
      console.log(JSON.stringify({ event: "fraud.hold", orderId, score: assessment.score, reasons: assessment.reasons }));
    }
  }

  // Per-order extras persisted once the payment session exists: gift
  // records (delivery fires on the paid webhook) and the referral
  // attribution (flips to "earned" on the paid webhook).
  const persistOrderExtras = async () => {
    if (loyaltyPointsSpent > 0) {
      await commitSpendForOrder(email, orderId, loyaltyPointsSpent);
    }
    if (giftInputs.length > 0) {
      await createGifts(orderId, email, giftInputs);
    }
    if (body.refCode && (await getFlag("referrals"))) {
      const refConfig = await getReferralConfig();
      await recordAttribution({
        code: body.refCode, orderId, buyerEmail: email,
        orderTotalUSD: total, commissionPercent: refConfig.commissionPercent,
      });
    }
  };

  const provider = body.provider === "paypal" ? "paypal" : "stripe";
  const base = siteUrl();

  if (provider === "stripe" && process.env.STRIPE_SECRET_KEY) {
    const form = new URLSearchParams();
    form.set("mode", "payment");
    // Optional email: only prefill Stripe's receipt email when given.
    if (email) form.set("customer_email", email);
    form.set("client_reference_id", orderId);
    form.set("success_url", `${base}/${locale}/success?session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${base}/${locale}/checkout`);
    form.set("metadata[order_id]", orderId);
    form.set("metadata[product_ids]", productIds.join(","));
    form.set("metadata[delivery_channel]", deliveryChannel);
    if (byoDiscountUSD > 0) form.set("metadata[byo_discount_usd]", byoDiscountUSD.toFixed(2));
    if (bumpLines.length > 0) form.set("metadata[bump_product_ids]", bumpLines.map((b) => b.productId).join(","));
    if (deliverySubjectHash) form.set("metadata[delivery_subject_hash]", deliverySubjectHash);
    // Phase 4 metadata: flash campaign ids, gift items, loyalty spend.
    if (flashUnitsBySale.size > 0) form.set("metadata[flash_sale_ids]", [...flashUnitsBySale.keys()].join(","));
    if (giftInputs.length > 0) form.set("metadata[gift_product_ids]", giftInputs.map((g) => g.productId).join(","));
    if (loyaltyPointsSpent > 0) form.set("metadata[loyalty_points]", String(loyaltyPointsSpent));
    form.set("payment_method_types[0]", "card");
    form.set("payment_method_types[1]", "link");
    // One aggregated line keeps Stripe Tax/coupons simple in this release;
    // per-item lines carry the real catalog titles for the receipt.
    let idx = 0;
    for (const line of lineItems) {
      form.set(`line_items[${idx}][quantity]`, "1");
      form.set(`line_items[${idx}][price_data][currency]`, "usd");
      form.set(`line_items[${idx}][price_data][unit_amount]`, String(Math.round(line.amountUSD * 100)));
      form.set(`line_items[${idx}][price_data][product_data][name]`, line.title);
      idx++;
    }
    if (discount > 0) {
      // Apply the coupon as a negative adjustment line is not supported;
      // instead reduce via a one-off Stripe coupon created on the fly.
      const couponForm = new URLSearchParams();
      couponForm.set("amount_off", String(Math.round(discount * 100)));
      couponForm.set("currency", "usd");
      couponForm.set("duration", "once");
      couponForm.set("name", `Astralium ${body.coupon ?? "discount"}`);
      const cRes = await fetch("https://api.stripe.com/v1/coupons", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_API_VERSION, "Content-Type": "application/x-www-form-urlencoded" },
        body: couponForm,
      });
      if (cRes.ok) {
        const c = (await cRes.json()) as { id: string };
        form.set("discounts[0][coupon]", c.id);
      }
    }
    void total;
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_API_VERSION, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const session = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !session.url) {
      if (fraudOn && email) await recordFailedAttempt({ email, ip: clientIp });
      return NextResponse.json({ error: session.error?.message ?? "STRIPE_ERROR" }, { status: 502 });
    }
    // Order ledger (F1): the PENDING order exists from this moment; the
    // webhook will transition it. Ledger failure must not break checkout.
    if (session.id) {
      await createPendingOrder({
        orderId, email, provider: "stripe", providerRef: session.id,
        items: productIds.map((pid) => ({ productId: pid, priceUSD: catalogById.get(pid)?.priceUSD ?? 0 })),
        totalUSD: total, currency: "USD",
        deliveryChannel, deliverySubjectHash: deliverySubjectHash ?? null,
        country: getClientCountry(req) ?? null, locale,
      }).catch(() => undefined);
    }
    await persistOrderExtras();
    await countFlashUnits();
    return NextResponse.json({
      url: session.url, sessionId: session.id, orderId,
      pricing: {
        subtotalUSD: Math.round(subtotal * 100) / 100,
        couponDiscountUSD, byoDiscountUSD, flashDiscountUSD, loyaltyRedeemUSD,
        totalUSD: total,
      },
    });
  }

  if (provider === "paypal" && paypalConfigured()) {
    const accessToken = await getPaypalAccessToken();
    if (!accessToken) {
      if (fraudOn && email) await recordFailedAttempt({ email, ip: clientIp });
      return NextResponse.json({ error: "PAYPAL_AUTH_FAILED" }, { status: 502 });
    }
    // One shared order body for both flows (lib/paypal.ts). The SDK
    // flow ignores the return/cancel URLs (approval happens on-page);
    // the redirect flow lands back on the success page, where PayPal
    // appends its order id as `token` and the page verifies against
    // the ledger before issuing downloads.
    const created = await createPaypalOrder(
      accessToken,
      buildPaypalOrderBody({
        orderId,
        productIds,
        totalUSD: total,
        email: email || null,
        returnUrl: `${base}/${locale}/success?order=${orderId}`,
        cancelUrl: `${base}/${locale}/checkout`,
      }),
    );
    // Redirect flow needs the approve link; the SDK flow only needs
    // the PayPal order id (the SDK renders its own approval UI).
    if (!created || (!sdkMode && !created.approveUrl)) {
      if (fraudOn && email) await recordFailedAttempt({ email, ip: clientIp });
      return NextResponse.json({ error: "PAYPAL_ORDER_FAILED" }, { status: 502 });
    }
    // Order ledger (F1): PENDING order anchored on the PayPal order id.
    await createPendingOrder({
      orderId, email, provider: "paypal", providerRef: created.id,
      items: productIds.map((pid) => ({ productId: pid, priceUSD: catalogById.get(pid)?.priceUSD ?? 0 })),
      totalUSD: total, currency: "USD",
      deliveryChannel, deliverySubjectHash: deliverySubjectHash ?? null,
      country: getClientCountry(req) ?? null, locale,
    }).catch(() => undefined);
    await persistOrderExtras();
    await countFlashUnits();
    return NextResponse.json({
      url: created.approveUrl, providerOrderId: created.id, orderId,
      pricing: {
        subtotalUSD: Math.round(subtotal * 100) / 100,
        couponDiscountUSD, byoDiscountUSD, flashDiscountUSD, loyaltyRedeemUSD,
        totalUSD: total,
      },
    });
  }

  return NextResponse.json(
    { error: "PAYMENTS_NOT_CONFIGURED", requiredEnv: REQUIRED_ENV },
    { status: 503 },
  );
}
