"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { useStore, type CartItem, type OrderRecord } from "../lib/store";
import { formatPrice } from "../lib/currency";
import { priceCart } from "../lib/coupons";
import { byoDiscount } from "../lib/byo";
import { getProductById } from "../data/products";
import Cover from "./Cover";
import { normalizePhone, PHONE_COUNTRIES, countryForLocalePhone } from "../lib/phone";
import { readPwywChoices } from "./ProductCommerce";
import { track } from "../lib/track-client";
// Owner fix (2026-11): optional checkout email + express single-item
// checkout + on-page PayPal SDK (Smart Buttons / Card Fields).
import { normalizeCheckoutEmail } from "../lib/checkout-rules";
import { checkoutItemsFor, shouldClearCart } from "../lib/express";
import PayPalSdk from "./PayPalSdk";

interface BumpOffer {
  productId: string; title: string; priceUSD: number; discountPercent: number;
}

type ChannelKey = "email" | "whatsapp" | "messenger" | "instagram";

interface Phase4Features {
  gifts: boolean;
  loyalty: boolean;
  expressStripe: boolean;
  expressPaypal: boolean;
  /** Raw provider configuration (server env presence), independent of
   *  the express flag: the provider select offers ONLY configured
   *  providers, so a customer can never pick one that would fail. */
  stripeConfigured: boolean;
  paypalConfigured: boolean;
}

interface GiftDraft {
  enabled: boolean;
  recipientEmail: string;
  message: string;
  sendAt: string;
}

export default function CheckoutClient({
  locale,
  dict,
  currency,
  channels,
  features,
  flashPrices,
  paypalClientId,
  paypalClientToken,
  expressItem,
}: {
  locale: string;
  dict: Dict;
  currency: string;
  channels: { key: ChannelKey; available: boolean }[];
  features: Phase4Features;
  flashPrices: Record<string, number>;
  /** Public PayPal client id (server-rendered) for the on-page SDK. */
  paypalClientId?: string | null;
  /** Server-minted Card Fields client token; absent → Buttons only. */
  paypalClientToken?: string | null;
  /** Express intent: when set, this checkout contains ONLY this item
   *  and the cart is left completely untouched. */
  expressItem?: CartItem | null;
}) {
  const { cart, subtotal, clear, saveOrder, prunedTitles, dismissPruned, syncCartWithCatalog } = useStore();
  // The single item list every total, payload and summary below is
  // computed from: the express item alone, or the cart as-is.
  const items = checkoutItemsFor(expressItem ?? null, cart);
  const expressMode = Boolean(expressItem);
  // Thermal fix: a cart checkout first reconciles the on-device cart
  // snapshot with the live catalog (dead items pruned with a notice,
  // prices refreshed). Express checkout never touches the cart — its
  // item was resolved server-side from the catalog already.
  useEffect(() => {
    if (!expressMode) void syncCartWithCatalog();
  }, [expressMode, syncCartWithCatalog]);
  // Phase 6, feature 27: reaching checkout is a funnel step (no-op
  // unless the analytics beacon is mounted).
  useEffect(() => { track("checkout_start"); }, []);
  // 2026-11 redesign: the mockups' PayPal-branded express buttons
  // record a provider preference before routing here; honour it when
  // PayPal is configured. Selection only — the payment flow itself
  // (providers offered, /api/checkout payload) is unchanged.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("astralium-provider") === "paypal" && features.paypalConfigured) {
        setProvider("paypal");
      }
    } catch { /* preference is best-effort */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<"stripe" | "paypal">(
    features.stripeConfigured ? "stripe" : "paypal",
  );
  // Busy ONLY while money is genuinely in motion: set inside
  // startCheckout at order creation (always after an explicit buyer
  // action) and cleared on create failure, on capture
  // pending/unconfirmed, on SDK error, and on buyer cancel (the
  // PayPalSdk onCancel below — the path that used to strand this
  // flag forever, register item 84). SDK loading/mounting never
  // sets it.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When a capture may have moved money (pending review, or captured
  // but fulfilment unconfirmed), the buyer gets the honest
  // "being confirmed" message plus this link to the success page,
  // which polls the ledger until the downloads unlock.
  const [confirmingUrl, setConfirmingUrl] = useState<string | null>(null);
  // The mapped, buyer-readable error from the last /api/checkout call.
  // The PayPal SDK overwrites errors with its generic label on any
  // throw — this ref lets onError keep OUR precise message instead.
  const serverErrorRef = useRef<string | null>(null);
  // Delivery channel (Phase 2): email default; social channels appear only
  // when the server says their flag is on AND the provider is configured.
  const [channel, setChannel] = useState<ChannelKey>("email");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(() => countryForLocalePhone(locale));
  const [optIn, setOptIn] = useState(false);
  const offered = channels.filter((c) => c.key === "email" || c.available);

  const coupon = useMemo(() => {
    try {
      const raw = sessionStorage.getItem("astralium-coupon");
      return raw ? (JSON.parse(raw) as { code: string; discountUSD: number }) : null;
    } catch {
      return null;
    }
  }, []);

  // Order bumps (Phase 3, feature 4): the offers endpoint 403s when the
  // order_bump flag is off — then nothing renders and nothing is sent.
  // Display prices are computed locally; the server re-derives them.
  const [bumps, setBumps] = useState<BumpOffer[]>([]);
  const [selectedBumps, setSelectedBumps] = useState<string[]>([]);
  useEffect(() => {
    // Express checkout contains ONLY the chosen item — an order bump
    // would add another product, so bumps are never offered there.
    if (expressMode) return;
    void (async () => {
      try {
        const found: BumpOffer[] = [];
        for (const item of cart.filter((i) => i.kind === "product")) {
          const res = await fetch(`/api/offers?productId=${encodeURIComponent(item.id)}`);
          if (!res.ok) continue;
          const data = (await res.json()) as { bump: BumpOffer | null };
          if (data.bump && !cart.some((i) => i.id === data.bump!.productId)) found.push(data.bump);
        }
        setBumps(found);
      } catch { /* no bumps */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const bumpTotal = bumps
    .filter((b) => selectedBumps.includes(b.productId))
    .reduce((s, b) => s + Math.round(b.priceUSD * (1 - b.discountPercent / 100) * 100) / 100, 0);
  // BYO display estimate priced from the checkout items themselves
  // (catalog-synced): the seed list cannot see office-created books,
  // so the discount the server will apply never showed here.
  const byo = byoDiscount(
    items.filter((i) => i.kind === "product").map((i) => i.id),
    items.map((i) => ({ id: i.id, priceUSD: i.priceUSD })),
  );

  // Phase 4 display pricing: PWYW choices (session) and flash-sale
  // prices (server-computed, passed as props) override catalog prices
  // in the summary. The server recomputes everything at checkout —
  // these numbers are display-only.
  const pwywChoices = useMemo(() => readPwywChoices(), []);
  const displayPrice = (item: { id: string; kind: string; priceUSD: number }): number => {
    if (item.kind !== "product") return item.priceUSD;
    return pwywChoices[item.id]?.amountUSD ?? flashPrices[item.id] ?? item.priceUSD;
  };
  const adjustedSubtotal = Math.round(items.reduce((s, i) => s + displayPrice(i), 0) * 100) / 100;
  void subtotal;
  const totals = priceCart(adjustedSubtotal + bumpTotal, (coupon?.discountUSD ?? 0) + byo.discountUSD);

  // Phase 4: gift drafts per product + loyalty redemption state.
  const [giftDrafts, setGiftDrafts] = useState<Record<string, GiftDraft>>({});
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState("");
  useEffect(() => {
    if (!features.loyalty || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    void (async () => {
      try {
        const res = await fetch(`/api/loyalty?email=${encodeURIComponent(email)}`);
        if (res.ok) {
          const data = (await res.json()) as { balance: number };
          setLoyaltyBalance(data.balance);
        }
      } catch { /* loyalty display is best-effort */ }
    })();
  }, [features.loyalty, email]);

  // Abandoned-cart snapshot (Phase 5, feature 20): once a valid email
  // and a non-empty cart sit together for a moment, capture the snapshot
  // server-side. The endpoint 403s while email_automation is off and
  // every failure here is silent — checkout never depends on it.
  useEffect(() => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const productIds = items.filter((i) => i.kind === "product").map((i) => i.id);
    if (productIds.length === 0) return;
    const timer = setTimeout(() => {
      void fetch("/api/cart/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, productIds, locale }),
        keepalive: true,
      }).catch(() => { /* best-effort */ });
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, cart, locale]);

  interface PreparedCheckout {
    cleanEmail: string;
    giftList: { productId: string; recipientEmail: string; message?: string; sendAt?: string }[];
    pwywPayload: Record<string, { amountUSD?: number; tierIndex?: number }>;
    phoneE164?: string;
    loyaltyRequested: number;
    refCode?: string;
  }

  /**
   * Validate the form and derive every payload value ONCE — shared by
   * the redirect flow and the PayPal SDK flow so both checkouts behave
   * identically (the server re-validates everything regardless).
   * Returns null after setting the visible error.
   */
  function prepareCheckout(): PreparedCheckout | null {
    // Email is OPTIONAL (owner fix, 2026-11): blank is fine; a typed
    // email must be well-formed (same rule as the server —
    // lib/checkout-rules).
    const emailCheck = normalizeCheckoutEmail(email);
    if (!emailCheck.ok) {
      setError(dict.newsletter_bad);
      return null;
    }
    const cleanEmail = emailCheck.email;
    // WhatsApp delivery needs a valid E.164 number + explicit opt-in.
    let phoneE164: string | undefined;
    if (channel === "whatsapp") {
      const parsed = normalizePhone(phone, phoneCountry);
      if (!parsed.ok) {
        setError(dict.delivery_phone_hint);
        return null;
      }
      if (!optIn) {
        setError(dict.delivery_optin_label);
        return null;
      }
      phoneE164 = parsed.e164;
    }
    // Phase 4 payloads — every value is re-validated server-side.
    const giftList = features.gifts
      ? items
          .filter((i) => i.kind === "product" && giftDrafts[i.id]?.enabled)
          .map((i) => ({
            productId: i.id,
            recipientEmail: giftDrafts[i.id].recipientEmail.trim(),
            message: giftDrafts[i.id].message.trim() || undefined,
            sendAt: giftDrafts[i.id].sendAt || undefined,
          }))
      : [];
    for (const g of giftList) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.recipientEmail)) {
        setError(dict.gift_recipient_ph);
        return null;
      }
    }
    // Gift orders are the one flow that genuinely needs the buyer's
    // email (gift records + claim codes are keyed to it; the server
    // enforces the same rule with EMAIL_REQUIRED_FOR_GIFTS).
    if (giftList.length > 0 && !cleanEmail) {
      setError(dict.checkout_email_hint);
      return null;
    }
    const pwywPayload: Record<string, { amountUSD?: number; tierIndex?: number }> = {};
    for (const item of items.filter((i) => i.kind === "product")) {
      const choice = pwywChoices[item.id];
      if (choice) {
        pwywPayload[item.id] = choice.tierIndex !== undefined
          ? { tierIndex: choice.tierIndex }
          : { amountUSD: choice.amountUSD };
      }
    }
    const refCode = (() => {
      try {
        const m = document.cookie.match(/(?:^|;\s*)astralium-ref=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : undefined;
      } catch {
        return undefined;
      }
    })();
    const loyaltyRequested = features.loyalty ? Math.max(0, Math.floor(Number(loyaltyPoints) || 0)) : 0;
    return { cleanEmail, giftList, pwywPayload, phoneE164, loyaltyRequested, refCode };
  }

  interface CheckoutResponse {
    url?: string | null; error?: string; items?: string[]; sessionId?: string; providerOrderId?: string;
    pricing?: { totalUSD: number };
  }

  /**
   * POST /api/checkout and record the on-device order. `mode: "sdk"`
   * asks the server for a PayPal order id to approve ON this page;
   * the redirect mode returns the provider URL as before. On failure
   * the visible error is set and null is returned.
   */
  async function startCheckout(opts: {
    mode: "redirect" | "sdk";
    usedProvider: "stripe" | "paypal";
  }): Promise<{ data: CheckoutResponse; orderId: string } | null> {
    const prepared = prepareCheckout();
    if (!prepared) return null;
    setBusy(true);
    setError(null);
    setConfirmingUrl(null);
    serverErrorRef.current = null;
    // Millisecond timestamps alone can collide (two checkouts in the
    // same ms share an id and the second order loses its ledger row);
    // a random suffix keeps every attempt's id unique.
    const orderId = `AST-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ id: i.id, kind: i.kind })),
          email: prepared.cleanEmail,
          provider: opts.usedProvider,
          mode: opts.mode === "sdk" ? "sdk" : undefined,
          coupon: coupon?.code,
          bumpProductIds: selectedBumps,
          locale,
          orderId,
          delivery: { channel, phoneE164: prepared.phoneE164, optIn: channel === "whatsapp" ? optIn : undefined },
          pwyw: Object.keys(prepared.pwywPayload).length > 0 ? prepared.pwywPayload : undefined,
          gifts: prepared.giftList.length > 0 ? prepared.giftList : undefined,
          loyaltyPoints: prepared.loyaltyRequested > 0 ? prepared.loyaltyRequested : undefined,
          refCode: prepared.refCode,
        }),
      });
      const data = (await res.json()) as CheckoutResponse;
      if (res.status === 503 || data.error === "PAYMENTS_NOT_CONFIGURED") {
        setError(dict.payments_not_configured);
        serverErrorRef.current = dict.payments_not_configured;
        setBusy(false);
        return null;
      }
      if (!res.ok) {
        // Buyer-readable mapping only — raw server codes
        // (UNKNOWN_ITEM:…, PAYPAL_ORDER_FAILED, provider messages)
        // are never shown verbatim. A dead cart item gets its own
        // honest message + a fresh catalog sync that prunes it.
        const mapped = data.error === "ITEM_UNAVAILABLE" ? dict.err_item_unavailable : dict.err_pay_start;
        if (data.error === "ITEM_UNAVAILABLE") void syncCartWithCatalog();
        setError(mapped);
        serverErrorRef.current = mapped;
        setBusy(false);
        return null;
      }
      const order: OrderRecord = {
        orderId, email: prepared.cleanEmail,
        items: [
          ...items,
          ...bumps.filter((b) => selectedBumps.includes(b.productId)).map((b) => ({
            id: b.productId, kind: "product" as const,
            slug: getProductById(b.productId)?.slug ?? b.productId,
            title: b.title,
            priceUSD: Math.round(b.priceUSD * (1 - b.discountPercent / 100) * 100) / 100,
            hue: getProductById(b.productId)?.hue ?? 45,
          })),
        ],
        totalUSD: data.pricing?.totalUSD ?? totals.total,
        discountUSD: totals.discount, coupon: coupon?.code,
        provider: opts.usedProvider,
        providerRef: data.sessionId ?? data.providerOrderId,
        createdAt: new Date().toISOString(), status: "initiated",
      };
      saveOrder(order);
      return { data, orderId };
    } catch {
      setError(dict.err_network);
      serverErrorRef.current = dict.err_network;
      setBusy(false);
      return null;
    }
  }

  /** The classic redirect flow — unchanged behaviour, and the
   *  permanent fallback whenever the on-page SDK is unavailable. */
  async function pay(express?: "applepay" | "googlepay", providerOverride?: "stripe" | "paypal") {
    const usedProvider = express ? "stripe" : (providerOverride ?? provider);
    const started = await startCheckout({ mode: "redirect", usedProvider });
    if (!started) return;
    if (!started.data.url) {
      setError(dict.err_pay_start);
      setBusy(false);
      return;
    }
    // Express purchases never touch the cart; a cart checkout clears
    // it exactly as before.
    if (shouldClearCart(expressItem)) {
      clear();
      try { sessionStorage.removeItem("astralium-coupon"); } catch { /* best-effort */ }
    }
    location.href = started.data.url;
  }

  /** PayPal SDK: create the order on our server, approve on-page. */
  async function sdkCreateOrder(): Promise<string> {
    const started = await startCheckout({ mode: "sdk", usedProvider: "paypal" });
    if (!started?.data.providerOrderId) {
      throw new Error("paypal-order-create-failed");
    }
    return started.data.providerOrderId;
  }

  /** PayPal SDK: capture on our server, then go to the success page
   *  (which verifies against the ledger and issues the downloads).
   *  Capture-stage honesty (thermal fix): once approval happened, a
   *  failure must NEVER claim "no charge was made" — the capture may
   *  have completed. Three outcomes are distinguished:
   *   - paid        → navigate to the success page (downloads there);
   *   - pending     → PayPal is reviewing the capture; the download
   *                   unlocks automatically — show that, with the
   *                   order-status link;
   *   - unconfirmed → captured-but-unverified or a lost response:
   *                   "being confirmed — do not pay again" + link. */
  async function sdkCaptureOrder(paypalOrderId: string): Promise<void> {
    let data: { ok?: boolean; paid?: boolean; pending?: boolean; successUrl?: string; error?: string } = {};
    try {
      const res = await fetch("/api/checkout/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerOrderId: paypalOrderId }),
      });
      data = (await res.json().catch(() => ({}))) as typeof data;
      if (data.pending || data.error === "CAPTURE_PENDING") {
        setError(dict.err_capture_pending);
        serverErrorRef.current = dict.err_capture_pending;
        if (data.successUrl) setConfirmingUrl(data.successUrl);
        setBusy(false);
        throw new Error("capture-pending");
      }
      if (!res.ok || !data.ok || !data.successUrl) {
        throw new Error(data.error ?? "capture-failed");
      }
      if (data.paid === false) {
        setError(dict.err_charge_uncertain);
        serverErrorRef.current = dict.err_charge_uncertain;
        setConfirmingUrl(data.successUrl);
        setBusy(false);
        throw new Error("capture-unconfirmed");
      }
      if (shouldClearCart(expressItem)) {
        clear();
        try { sessionStorage.removeItem("astralium-coupon"); } catch { /* best-effort */ }
      }
      location.href = data.successUrl;
    } catch (err) {
      if (err instanceof Error && (err.message === "capture-pending" || err.message === "capture-unconfirmed")) {
        throw err; // precise message + link already set above
      }
      setError(dict.err_charge_uncertain);
      serverErrorRef.current = dict.err_charge_uncertain;
      if (data.successUrl) setConfirmingUrl(data.successUrl);
      setBusy(false);
      throw err;
    }
  }

  if (items.length === 0) {
    return <p className="empty-note" style={{ marginTop: 28 }}>{dict.cart_empty}</p>;
  }

  return (
    <div className="two-col">
      {!expressMode && prunedTitles.length > 0 && (
        <div className="panel" style={{ gridColumn: "1 / -1" }} role="status">
          <p style={{ margin: 0 }}>
            <strong>{dict.item_removed_notice}</strong>{" "}
            {prunedTitles.join(" · ")}{" "}
            <button type="button" className="btn btn-ghost" onClick={dismissPruned} aria-label="✕">✕</button>
          </p>
        </div>
      )}
      <div className="panel">
        <p className="muted">{dict.checkout_guest}</p>
        <div className="checkout-form">
          <label>
            {dict.checkout_email_label}
            <input
              type="email"
              placeholder={dict.email_ph}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <p className="muted" style={{ margin: 0 }}>{dict.checkout_email_hint}</p>
          {/* Phase 4, feature 16: express buttons render ONLY when the
              provider is actually configured (server-computed props) —
              Apple Pay / Google Pay via Stripe's hosted checkout (which
              presents Payment Element express methods), PayPal express
              via the PayPal order flow. No dead buttons, ever. */}
          {(features.expressStripe || features.expressPaypal) && (
            <div>
              <p style={{ margin: "0 0 8px", fontWeight: 700 }}>{dict.express_t}</p>
              <div className="express-row">
                {features.expressStripe && (
                  <>
                    <button type="button" className="express-btn" disabled={busy} onClick={() => pay("applepay")}> Pay</button>
                    <button type="button" className="express-btn" disabled={busy} onClick={() => pay("googlepay")}>G Pay</button>
                  </>
                )}
                {features.expressPaypal && (
                  <button type="button" className="express-btn paypal" disabled={busy} onClick={() => { setProvider("paypal"); void pay(undefined, "paypal"); }}>PayPal</button>
                )}
              </div>
            </div>
          )}
          {/* 2026-11 redesign: the payment method renders as the
              mockups' selected-method card (gold border, radio dot).
              The control inside is the same provider <select> with the
              same options logic — only configured providers, ever. */}
          <div className="method-card">
            <span className="method-dot" aria-hidden="true" />
            <label className="method-main">
              {dict.provider_t}
              <select value={provider} onChange={(e) => setProvider(e.target.value as "stripe" | "paypal")}>
                {features.stripeConfigured && (
                  <option value="stripe">Stripe — cards, Link, iDEAL, SEPA…</option>
                )}
                {features.paypalConfigured && <option value="paypal">PayPal</option>}
              </select>
            </label>
          </div>
          {/* Owner fix (2026-11): with PayPal selected, the buyer can
              pay ON this page — Smart Buttons, or bank card via
              PayPal's hosted Card Fields (rendered only when PayPal
              reports the account/buyer eligible; otherwise the
              section hides itself). The redirect button below always
              remains as the fallback. */}
          {provider === "paypal" && paypalClientId && (
            <PayPalSdk
              clientId={paypalClientId}
              clientToken={paypalClientToken}
              labels={{
                orCard: dict.pay_or_card,
                cardName: dict.pay_card_name,
                payByCard: dict.pay_by_card_btn,
                processing: dict.processing,
                error: dict.pay_error,
                preparing: dict.pay_preparing,
              }}
              createOrder={sdkCreateOrder}
              captureOrder={sdkCaptureOrder}
              onError={(message) => { setError(serverErrorRef.current ?? message); setBusy(false); }}
              onCancel={() => {
                // Buyer closed the PayPal popup / abandoned the card
                // challenge without paying. Busy was set when the
                // order was created; no navigation and no error
                // follow a cancel, so THIS is what returns the
                // checkout to idle — the gold button used to stay
                // disabled on "PROCESSING…" forever (item 84). The
                // stored server error is dropped too: the create
                // succeeded, so it is stale, and a cancel shows no
                // error.
                serverErrorRef.current = null;
                setBusy(false);
              }}
            />
          )}
          {offered.length > 1 && (
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: 8 }}>{dict.delivery_title}</legend>
              <div className="express-row" role="radiogroup" aria-label={dict.delivery_title}>
                {offered.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={channel === c.key}
                    className="express-btn"
                    style={channel === c.key ? { outline: "2px solid var(--gold)", outlineOffset: 2 } : undefined}
                    onClick={() => setChannel(c.key)}
                  >
                    {dict[`delivery_channel_${c.key}`]}
                  </button>
                ))}
              </div>
              <p className="muted">{dict.delivery_hint}</p>
              {channel === "whatsapp" && (
                <>
                  <label>
                    {dict.delivery_country_label}
                    <select value={phoneCountry} onChange={(e) => setPhoneCountry(e.target.value)}>
                      {PHONE_COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {dict.delivery_phone_label}
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="+212 612 345 678"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </label>
                  <p className="muted">{dict.delivery_phone_hint}</p>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
                    <span>{dict.delivery_optin_label}</span>
                  </label>
                </>
              )}
            </fieldset>
          )}
          {bumps.length > 0 && (
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: 8 }}>{dict.bump_t}</legend>
              {bumps.map((b) => {
                const price = Math.round(b.priceUSD * (1 - b.discountPercent / 100) * 100) / 100;
                return (
                  <label key={b.productId} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={selectedBumps.includes(b.productId)}
                      onChange={(e) => setSelectedBumps((cur) => e.target.checked ? [...cur, b.productId] : cur.filter((x) => x !== b.productId))}
                    />
                    <span>
                      <strong>{b.title}</strong> — {dict.bump_add}{" "}
                      {formatPrice(price, currency, locale)} <s>{formatPrice(b.priceUSD, currency, locale)}</s> (−{b.discountPercent}%)
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {features.gifts && items.some((i) => i.kind === "product") && (
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: 8 }}>🎁 {dict.gift_t}</legend>
              {items.filter((i) => i.kind === "product").map((item) => {
                const draft = giftDrafts[item.id] ?? { enabled: false, recipientEmail: "", message: "", sendAt: "" };
                const set = (patch: Partial<GiftDraft>) =>
                  setGiftDrafts((cur) => ({ ...cur, [item.id]: { ...draft, ...patch } }));
                return (
                  <div key={item.id} style={{ marginBottom: 10 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                      <span><strong>{item.title}</strong></span>
                    </label>
                    {draft.enabled && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                        <input
                          type="email"
                          placeholder={dict.gift_recipient_ph}
                          value={draft.recipientEmail}
                          onChange={(e) => set({ recipientEmail: e.target.value })}
                          autoComplete="off"
                        />
                        <input
                          type="text"
                          placeholder={dict.gift_message_ph}
                          value={draft.message}
                          maxLength={500}
                          onChange={(e) => set({ message: e.target.value })}
                        />
                        <label>
                          {dict.gift_send_date}
                          <input type="date" value={draft.sendAt} onChange={(e) => set({ sendAt: e.target.value })} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="muted">{dict.gift_note}</p>
            </fieldset>
          )}
          {features.loyalty && loyaltyBalance !== null && loyaltyBalance > 0 && (
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: 8 }}>✦ {dict.loyalty_t}</legend>
              <p className="muted" style={{ marginTop: 0 }}>
                {dict.loyalty_balance}: {loyaltyBalance} {dict.loyalty_points_unit}
              </p>
              <label>
                {dict.loyalty_redeem_label}
                <input
                  type="number"
                  min={0}
                  max={loyaltyBalance}
                  step={1}
                  value={loyaltyPoints}
                  onChange={(e) => setLoyaltyPoints(e.target.value)}
                  placeholder="0"
                />
              </label>
            </fieldset>
          )}
          {error && <p className="err-text" role="alert">{error}</p>}
          {confirmingUrl && (
            <p style={{ margin: 0 }}>
              <a className="btn btn-ghost" href={confirmingUrl}>{dict.order_status_view}</a>
            </p>
          )}
          {provider === "paypal" && paypalClientId && (
            <p className="muted" style={{ margin: 0 }}>{dict.pay_redirect_fallback}</p>
          )}
          <button type="button" className="btn btn-grad btn-lg" disabled={busy} data-loading={busy || undefined} onClick={() => pay()}>
            🔒 {busy ? dict.processing : `${dict.pay_btn} · ${formatPrice(totals.total, currency, locale)}`}
          </button>
          <p className="secure-note">🔒 {dict.checkout_secure_note}</p>
          <p className="muted">Visa · Mastercard · Amex · Apple Pay · Google Pay · Link · iDEAL · SEPA · PayPal — {dict.trust_secure}</p>
        </div>
      </div>
      <div className="panel summary-panel">
        <h2 style={{ marginTop: 0 }}>{dict.checkout_summary}</h2>
        {items.map((i) => (
          <div key={i.id} className="summary-row sum-item">
            <span className="sum-thumb" aria-hidden="true">
              <Cover
                id={i.id}
                title={i.title}
                category={i.kind === "product" ? (getProductById(i.id)?.category ?? "ebooks") : "templates"}
                hue={i.hue}
                size="sm"
              />
            </span>
            <span className="grow">{i.title}</span>
            <span>
              {displayPrice(i) !== i.priceUSD && <s style={{ marginRight: 6 }}>{formatPrice(i.priceUSD, currency, locale)}</s>}
              {formatPrice(displayPrice(i), currency, locale)}
            </span>
          </div>
        ))}
        {bumps.filter((b) => selectedBumps.includes(b.productId)).map((b) => (
          <p key={b.productId} className="summary-row">
            <span>{b.title} (−{b.discountPercent}%)</span>
            <span>{formatPrice(Math.round(b.priceUSD * (1 - b.discountPercent / 100) * 100) / 100, currency, locale)}</span>
          </p>
        ))}
        {(coupon?.discountUSD ?? 0) > 0 && (
          <p className="summary-row"><span>{dict.cart_discount} ({coupon?.code})</span><span>−{formatPrice(coupon?.discountUSD ?? 0, currency, locale)}</span></p>
        )}
        {byo.discountUSD > 0 && (
          <p className="summary-row"><span>{dict.byo_discount_label}</span><span>−{formatPrice(byo.discountUSD, currency, locale)}</span></p>
        )}
        <p className="summary-row summary-total"><span>{dict.cart_total}</span><span>{formatPrice(totals.total, currency, locale)}</span></p>
        {currency !== "USD" && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {dict.charge_in_usd_note.replace("{amount}", `$${totals.total.toFixed(2)}`).replace("{currency}", currency)}
          </p>
        )}
      </div>
    </div>
  );
}
