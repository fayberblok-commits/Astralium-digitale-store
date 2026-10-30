"use client";
import { useMemo, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { useStore, type OrderRecord } from "../lib/store";
import { formatPrice } from "../lib/currency";
import { priceCart } from "../lib/coupons";
import { normalizePhone, PHONE_COUNTRIES, countryForLocalePhone } from "../lib/phone";

type ChannelKey = "email" | "whatsapp" | "messenger" | "instagram";

export default function CheckoutClient({
  locale,
  dict,
  currency,
  channels,
}: {
  locale: string;
  dict: Dict;
  currency: string;
  channels: { key: ChannelKey; available: boolean }[];
}) {
  const { cart, subtotal, clear, saveOrder } = useStore();
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
  const totals = priceCart(subtotal, coupon?.discountUSD ?? 0);

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
          locale,
          orderId,
          delivery: { channel, phoneE164, optIn: channel === "whatsapp" ? optIn : undefined },
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string; sessionId?: string; providerOrderId?: string };
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
        orderId, email, items: cart, totalUSD: totals.total,
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
          <div>
            <p style={{ margin: "0 0 8px", fontWeight: 700 }}>{dict.express_t}</p>
            <div className="express-row">
              <button type="button" className="express-btn" disabled={busy} onClick={() => pay("applepay")}> Pay</button>
              <button type="button" className="express-btn" disabled={busy} onClick={() => pay("googlepay")}>G Pay</button>
              <button type="button" className="express-btn paypal" disabled={busy} onClick={() => { setProvider("paypal"); void pay(); }}>PayPal</button>
            </div>
          </div>
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
            <span>{formatPrice(i.priceUSD, currency, locale)}</span>
          </p>
        ))}
        {totals.discount > 0 && (
          <p className="summary-row"><span>{dict.cart_discount} ({coupon?.code})</span><span>−{formatPrice(totals.discount, currency, locale)}</span></p>
        )}
        <p className="summary-row summary-total"><span>{dict.cart_total}</span><span>{formatPrice(totals.total, currency, locale)}</span></p>
      </div>
    </div>
  );
}
