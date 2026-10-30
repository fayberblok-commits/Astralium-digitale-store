"use client";
/**
 * Wishlist extras (Phase 3, feature 8): a share link (product slugs in
 * the URL — no account data) and explicit opt-in price-drop alerts.
 * Registration posts one alert per wished product; when the alerts flag
 * is off the API answers 403 and the form reports that honestly.
 */
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { PRODUCTS } from "../data/products";
import { encodeShareItems } from "../lib/share";

export default function WishlistExtras({
  locale,
  dict,
  wishlistSlugs,
}: {
  locale: string;
  dict: Dict;
  wishlistSlugs: string[];
}) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [alertsMsg, setAlertsMsg] = useState<"ok" | "off" | "bad" | null>(null);

  if (wishlistSlugs.length === 0) return null;
  const shareUrl = `/${locale}/wishlist/shared?items=${encodeURIComponent(encodeShareItems(wishlistSlugs))}`;

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(`${location.origin}${shareUrl}`);
      setCopied(true);
    } catch { setCopied(false); }
  }

  async function registerAlerts() {
    setAlertsMsg(null);
    try {
      let anyOk = false;
      let disabled = false;
      for (const slug of wishlistSlugs) {
        const product = PRODUCTS.find((p) => p.slug === slug);
        if (!product) continue;
        const res = await fetch("/api/wishlist/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, productId: product.id, optIn }),
        });
        if (res.status === 403) disabled = true;
        if (res.ok) anyOk = true;
      }
      setAlertsMsg(anyOk ? "ok" : disabled ? "off" : "bad");
    } catch { setAlertsMsg("bad"); }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <p style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <a href={shareUrl} className="btn">{dict.wishlist_share}</a>
        <button type="button" className="btn btn-ghost" onClick={() => void copyShare()}>{dict.wishlist_share}</button>
        {copied && <span className="ok-text" role="status">{dict.wishlist_share_copied}</span>}
      </p>
      <h3>{dict.wishlist_alerts_t}</h3>
      <p className="muted">{dict.wishlist_alerts_hint}</p>
      <div className="checkout-form">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={dict.email_ph} aria-label={dict.email_ph} />
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
          <span>{dict.wishlist_alerts_hint}</span>
        </label>
        <button type="button" className="btn" onClick={() => void registerAlerts()}>{dict.wishlist_alerts_btn}</button>
        {alertsMsg === "ok" && <p className="ok-text" role="status">{dict.wishlist_alerts_ok}</p>}
        {alertsMsg === "off" && <p className="muted" role="status">FEATURE_DISABLED</p>}
        {alertsMsg === "bad" && <p className="err-text" role="alert">…</p>}
      </div>
    </div>
  );
}
