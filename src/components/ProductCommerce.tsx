"use client";
/**
 * Phase 4 commerce blocks for the product page (features 9, 13, 14, 15):
 * flash-sale price + countdown, pre-order badge, PWYW tiers, subscribe.
 * All state comes from /api/products/[id]/commerce — server-computed,
 * flag-gated; when nothing is enabled/configured this renders nothing.
 * The countdown target is the server-provided campaign end timestamp.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { useStore, type CartItem } from "../lib/store";
import { formatPrice } from "../lib/currency";

interface CommerceState {
  flash: { name: string; discountPercent: number; fullPriceUSD: number; priceUSD: number; endsAt: string; remaining: number | null } | null;
  pwyw: { minUSD: number; suggestedUSD: number; tiers: { priceUSD: number; label: string; bonus: string }[] } | null;
  preorder: { releaseDate: string; released: boolean } | null;
  plan: { interval: "month" | "year"; priceUSD: number } | null;
}

export const PWYW_STORAGE_KEY = "astralium-pwyw";

export interface PwywStoredChoice {
  tierIndex?: number;
  amountUSD: number; // effective display price
}

export function readPwywChoices(): Record<string, PwywStoredChoice> {
  try {
    return JSON.parse(sessionStorage.getItem(PWYW_STORAGE_KEY) ?? "{}") as Record<string, PwywStoredChoice>;
  } catch {
    return {};
  }
}

function useCountdown(endsAt: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!endsAt) return;
    const tick = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      if (ms <= 0) { setLabel("0:00"); return; }
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setLabel(d > 0 ? `${d}d ${h}h ${m}m` : `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  return label;
}

export default function ProductCommerce({
  product,
  locale,
  dict,
  currency,
}: {
  product: { id: string; slug: string; title: string; priceUSD: number; hue: number };
  locale: string;
  dict: Dict;
  currency: string;
}) {
  const [state, setState] = useState<CommerceState | null>(null);
  const countdown = useCountdown(state?.flash?.endsAt ?? null);
  const { add, inCart } = useStore();
  // PWYW picker state
  const [tierIndex, setTierIndex] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  // Subscription state
  const [subEmail, setSubEmail] = useState("");
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/products/${encodeURIComponent(product.id)}/commerce`);
        if (res.ok) setState((await res.json()) as CommerceState);
      } catch { /* no commerce blocks */ }
    })();
  }, [product.id]);

  if (!state || (!state.flash && !state.pwyw && !state.preorder && !state.plan)) return null;
  const pwyw = state.pwyw;
  const customAmount = Number(custom);
  const pwywAmount = tierIndex !== null && pwyw
    ? pwyw.tiers[tierIndex]?.priceUSD
    : Number.isFinite(customAmount) && customAmount > 0
      ? customAmount
      : pwyw?.suggestedUSD;
  const pwywValid = pwywAmount !== undefined && pwyw !== null && pwywAmount >= pwyw.minUSD;

  function addPwywToCart() {
    if (!pwyw || pwywAmount === undefined || !pwywValid) return;
    const choices = readPwywChoices();
    choices[product.id] = tierIndex !== null ? { tierIndex, amountUSD: pwywAmount } : { amountUSD: pwywAmount };
    try {
      sessionStorage.setItem(PWYW_STORAGE_KEY, JSON.stringify(choices));
    } catch { /* storage unavailable — server still prices from the checkout payload */ }
    const item: CartItem = {
      id: product.id, kind: "product", slug: product.slug,
      title: product.title, priceUSD: pwywAmount, hue: product.hue,
    };
    add(item);
  }

  async function subscribe(manage: boolean) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subEmail)) {
      setSubError(dict.newsletter_bad);
      return;
    }
    setSubBusy(true);
    setSubError(null);
    try {
      const res = await fetch(manage ? "/api/subscriptions/portal" : "/api/subscriptions/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, email: subEmail, locale }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setSubError(data.error === "NO_SUBSCRIPTION" ? dict.sub_unavailable : dict.sub_unavailable);
        setSubBusy(false);
        return;
      }
      location.href = data.url;
    } catch {
      setSubError(dict.sub_unavailable);
      setSubBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "14px 0" }}>
      {state.flash && (
        <div className="panel" role="status">
          <p style={{ margin: 0, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="pill pill-bad">⚡ {dict.flash_t} −{state.flash.discountPercent}%</span>
            <strong>{formatPrice(state.flash.priceUSD, currency, locale)}</strong>
            <s>{formatPrice(state.flash.fullPriceUSD, currency, locale)}</s>
            {countdown && <span className="muted">{dict.flash_ends_in} {countdown}</span>}
            {state.flash.remaining !== null && state.flash.remaining <= 0 && <span className="pill">{dict.flash_sold_out}</span>}
          </p>
        </div>
      )}
      {state.preorder && !state.preorder.released && (
        <p style={{ margin: 0 }}>
          <span className="pill">✦ {dict.preorder_badge}</span>{" "}
          <span className="muted">{dict.preorder_releases_on} {new Date(state.preorder.releaseDate).toLocaleDateString(locale)}</span>
        </p>
      )}
      {pwyw && (
        <fieldset className="panel" style={{ margin: 0 }}>
          <legend style={{ fontWeight: 700 }}>{dict.pwyw_t}</legend>
          <p className="muted" style={{ marginTop: 0 }}>{dict.pwyw_hint}</p>
          {pwyw.tiers.map((tier, i) => (
            <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
              <input
                type="radio"
                name={`pwyw-${product.id}`}
                checked={tierIndex === i}
                onChange={() => setTierIndex(i)}
              />
              <span>
                <strong>{formatPrice(tier.priceUSD, currency, locale)}</strong>
                {tier.label ? ` — ${tier.label}` : ""}
                {tier.bonus ? <span className="muted"> · {tier.bonus}</span> : null}
              </span>
            </label>
          ))}
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name={`pwyw-${product.id}`} checked={tierIndex === null} onChange={() => setTierIndex(null)} />
            <input
              type="number"
              min={pwyw.minUSD}
              step="0.5"
              placeholder={dict.pwyw_custom_ph}
              value={custom}
              onFocus={() => setTierIndex(null)}
              onChange={(e) => setCustom(e.target.value)}
              style={{ maxWidth: 160 }}
            />
            <span className="muted">{dict.pwyw_min_note} {formatPrice(pwyw.minUSD, currency, locale)}</span>
          </label>
          <p style={{ marginBottom: 0 }}>
            <button type="button" className="btn btn-primary" disabled={!pwywValid || inCart(product.id)} onClick={addPwywToCart}>
              {inCart(product.id) ? `✓ ${dict.in_cart}` : `${dict.add_to_cart} · ${pwywAmount !== undefined ? formatPrice(pwywAmount, currency, locale) : ""}`}
            </button>
          </p>
        </fieldset>
      )}
      {state.plan && (
        <fieldset className="panel" style={{ margin: 0 }}>
          <legend style={{ fontWeight: 700 }}>{dict.sub_t}</legend>
          <p style={{ marginTop: 0 }}>
            <strong>{formatPrice(state.plan.priceUSD, currency, locale)}</strong>{" "}
            <span className="muted">{dict.sub_price_note} {state.plan.interval === "year" ? "year" : "month"}</span>
          </p>
          <label>
            Email
            <input type="email" value={subEmail} onChange={(e) => setSubEmail(e.target.value)} placeholder={dict.email_ph} autoComplete="email" />
          </label>
          {subError && <p className="err-text" role="alert">{subError}</p>}
          <p style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 0 }}>
            <button type="button" className="btn btn-grad" disabled={subBusy} data-loading={subBusy || undefined} onClick={() => subscribe(false)}>{dict.sub_subscribe_cta}</button>
            <button type="button" className="btn btn-ghost" disabled={subBusy} onClick={() => subscribe(true)}>{dict.sub_manage_cta}</button>
          </p>
        </fieldset>
      )}
    </div>
  );
}
