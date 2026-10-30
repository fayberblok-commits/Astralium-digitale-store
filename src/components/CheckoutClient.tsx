"use client";
import { useEffect, useMemo, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { useStore, type OrderRecord } from "../lib/store";
import { formatPrice } from "../lib/currency";
import { priceCart } from "../lib/coupons";
import { byoDiscount } from "../lib/byo";
import { PRODUCTS, getProductById } from "../data/products";
import { normalizePhone, PHONE_COUNTRIES, countryForLocalePhone } from "../lib/phone";
import { readPwywChoices } from "./ProductCommerce";
import { track } from "../lib/track-client";

interface BumpOffer {
  productId: string; title: string; priceUSD: number; discountPercent: number;
}

type ChannelKey = "email" | "whatsapp" | "messenger" | "instagram";

interface Phase4Features {
  gifts: boolean;
  loyalty: boolean;
  expressStripe: boolean;
  expressPaypal: boolean;
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
}: {
  locale: string;
  dict: Dict;
  currency: string;
  channels: { key: ChannelKey; available: boolean }[];
  features: Phase4Features;
  flashPrices: Record<string, number>;
}) {
  const { cart, subtotal, clear, saveOrder } = useStore();
  // Phase 6, feature 27: reaching checkout is a funnel step (no-op
  // unless the analytics beacon is mounted).
  useEffect(() => { track("checkout_start"); }, []);
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<"stripe" | "paypal">("stripe");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const byo = byoDiscount(cart.filter((i) => i.kind === "product").map((i) => i.id), PRODUCTS);

  // Phase 4 display pricing: PWYW choices (session) and flash-sale
  // prices (server-computed, passed as props) override catalog prices
  // in the summary. The server recomputes everything at checkout —
  // these numbers are display-only.
  const pwywChoices = useMemo(() => readPwywChoices(), []);
  const displayPrice = (item: { id: string; kind: string; priceUSD: number }): number => {
    if (item.kind !== "product") return item.priceUSD;
    return pwywChoices[item.id]?.amountUSD ?? flashPrices[item.id] ?? item.priceUSD;
  };
  const adjustedSubtotal = Math.round(cart.reduce((s, i) => s + displayPrice(i), 0) * 100) / 100;
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
    const productIds = cart.filter((i) => i.kind === "product").map((i) => i.id);
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
  }, [email, cart, locale]);

  async function pay(express?: "applepay" | "googlepay") {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(dict.newsletter_bad);
      return;
    }
    // WhatsApp delivery needs a valid E.164 number + explicit opt-in.
    let phoneE164: string | undefined;
    if (channel === "whatsapp") {
      const parsed = normalizePhone(phone, phoneCountry);
      if (!parsed.ok) {
        setError(dict.delivery_phone_hint);
        return;
      }
      if (!optIn) {
        setError(dict.delivery_optin_label);
        return;
      }
      phoneE164 = parsed.e164;
    }
    // Phase 4 payloads — every value is re-validated server-side.
    const giftList = features.gifts
      ? cart
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
        return;
      }
    }
    const pwywPayload: Record<string, { amountUSD?: number; tierIndex?: number }> = {};
    for (const item of cart.filter((i) => i.kind === "product")) {
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

    setBusy(true);
    setError(null);
    const orderId = `AST-${Date.now().toString(36).toUpperCase()}`;
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((i) => ({ id: i.id, kind: i.kind })),
          email,
          provider: express ? "stripe" : provider,
          coupon: coupon?.code,
          bumpProductIds: selectedBumps,
          locale,
          orderId,
          delivery: { channel, phoneE164, optIn: channel === "whatsapp" ? optIn : undefined },
          pwyw: Object.keys(pwywPayload).length > 0 ? pwywPayload : undefined,
          gifts: giftList.length > 0 ? giftList : undefined,
          loyaltyPoints: loyaltyRequested > 0 ? loyaltyRequested : undefined,
          refCode,
        }),
      });
      const data = (await res.json()) as {
        url?: string; error?: string; sessionId?: string; providerOrderId?: string;
        pricing?: { totalUSD: number };
      };
      if (res.status === 503 || data.error === "PAYMENTS_NOT_CONFIGURED") {
        setError(dict.payments_not_configured);
        setBusy(false);
        return;
      }
      if (!res.ok || !data.url) {
        setError(data.error ?? "Payment could not be started.");
        setBusy(false);
        return;
      }
      const order: OrderRecord = {
        orderId, email,
        items: [
          ...cart,
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
        provider: express ? "stripe" : provider,
        providerRef: data.sessionId ?? data.providerOrderId,
        createdAt: new Date().toISOString(), status: "initiated",
      };
      saveOrder(order);
      clear();
      sessionStorage.removeItem("astralium-coupon");
      location.href = data.url;
    } catch {
      setError("Network error — please retry.");
      setBusy(false);
    }
  }

  if (cart.length === 0) {
    return <p className="empty-note" style={{ marginTop: 28 }}>{dict.cart_empty}</p>;
  }

  return (
    <div className="two-col">
      <div className="panel">
        <p className="muted">{dict.checkout_guest}</p>
        <div className="checkout-form">
          <label>
            Email
            <input
              type="email"
              required
              placeholder={dict.email_ph}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
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
                  <button type="button" className="express-btn paypal" disabled={busy} onClick={() => { setProvider("paypal"); void pay(); }}>PayPal</button>
                )}
              </div>
            </div>
          )}
          <label>
            {dict.provider_t}
            <select value={provider} onChange={(e) => setProvider(e.target.value as "stripe" | "paypal")}>
              <option value="stripe">Stripe — cards, Link, iDEAL, SEPA…</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>
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
          {features.gifts && cart.some((i) => i.kind === "product") && (
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 700, marginBottom: 8 }}>🎁 {dict.gift_t}</legend>
              {cart.filter((i) => i.kind === "product").map((item) => {
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
          <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => pay()}>
            🔒 {busy ? dict.processing : `${dict.pay_btn} · ${formatPrice(totals.total, currency, locale)}`}
          </button>
          <p className="muted">Visa · Mastercard · Amex · Apple Pay · Google Pay · Link · iDEAL · SEPA · PayPal — {dict.trust_secure}</p>
        </div>
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>{dict.cart_t}</h2>
        {cart.map((i) => (
          <p key={i.id} className="summary-row">
            <span>{i.title}</span>
            <span>
              {displayPrice(i) !== i.priceUSD && <s style={{ marginRight: 6 }}>{formatPrice(i.priceUSD, currency, locale)}</s>}
              {formatPrice(displayPrice(i), currency, locale)}
            </span>
          </p>
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
      </div>
    </div>
  );
}
