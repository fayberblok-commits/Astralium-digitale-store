"use client";
/**
 * Post-purchase upsell (Phase 3, feature 4): shows AT MOST ONE offer,
 * only when the order_bump flag is on (the offers API 403s otherwise)
 * and an upsell is configured for a purchased product. The CTA creates
 * a BRAND-NEW checkout session via /api/upsell — the original payment
 * is never re-charged.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { formatPrice } from "../lib/currency";

interface Upsell {
  productId: string; title: string; priceUSD: number; discountPercent: number;
}

export default function UpsellOffer({
  locale,
  dict,
  currency,
  orderId,
  email,
  purchasedProductIds,
}: {
  locale: string;
  dict: Dict;
  currency: string;
  orderId: string;
  email: string;
  purchasedProductIds: string[];
}) {
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const [forProduct, setForProduct] = useState<string>("");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        for (const pid of purchasedProductIds) {
          const res = await fetch(`/api/offers?productId=${encodeURIComponent(pid)}`);
          if (!res.ok) return; // flag off → no upsell UI at all
          const data = (await res.json()) as { upsell: Upsell | null };
          if (data.upsell && !purchasedProductIds.includes(data.upsell.productId)) {
            setUpsell(data.upsell);
            setForProduct(pid);
            return;
          }
        }
      } catch { /* no upsell */ }
    })();
  }, [purchasedProductIds]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/upsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, email, productId: forProduct, locale }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error === "PAYMENTS_NOT_CONFIGURED" ? dict.payments_not_configured : (data.error ?? "error"));
        setBusy(false);
        return;
      }
      location.href = data.url;
    } catch {
      setError("network");
      setBusy(false);
    }
  }

  if (!upsell || dismissed) return null;
  const price = Math.round(upsell.priceUSD * (1 - upsell.discountPercent / 100) * 100) / 100;
  return (
    <div className="panel" style={{ marginTop: 22, textAlign: "start" }}>
      <h2 style={{ marginTop: 0 }}>{dict.upsell_t}</h2>
      <p>
        <strong>{upsell.title}</strong> — {formatPrice(price, currency, locale)}{" "}
        <s>{formatPrice(upsell.priceUSD, currency, locale)}</s> (−{upsell.discountPercent}%)
      </p>
      {error && <p className="err-text" role="alert">{error}</p>}
      <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void accept()}>{dict.upsell_cta}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setDismissed(true)}>{dict.upsell_no}</button>
      </p>
    </div>
  );
}
