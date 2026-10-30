"use client";
/**
 * Refer & earn panel (Phase 4, feature 12): the customer's personal
 * referral link + recorded commission totals. Hides entirely when the
 * referrals flag is off (the API 403s). Payouts are recorded-only —
 * the copy says so, honestly.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { useStore } from "../lib/store";
import { formatPrice } from "../lib/currency";

interface RefData {
  code: string;
  link: string;
  commissionPercent: number;
  orders: number;
  earnedUSD: number;
  pendingUSD: number;
}

export default function ReferralPanel({ locale, dict, currency }: { locale: string; dict: Dict; currency: string }) {
  const { orders } = useStore();
  const [email, setEmail] = useState("");
  const [data, setData] = useState<RefData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (orders[0]?.email) setEmail(orders[0].email);
  }, [orders]);

  async function load() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    try {
      const res = await fetch("/api/referrals/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      if (res.status === 403) { setHidden(true); return; }
      if (res.ok) setData((await res.json()) as RefData);
    } catch { /* best-effort panel */ }
  }

  useEffect(() => {
    if (email) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  if (hidden) return null;
  return (
    <section className="section">
      <h2>✦ {dict.referral_t}</h2>
      <p className="muted">{dict.referral_desc}</p>
      {!data ? (
        <p style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={dict.email_ph}
            autoComplete="email"
          />
          <button type="button" className="btn btn-primary" onClick={() => void load()}>{dict.referral_t}</button>
        </p>
      ) : (
        <>
          <p style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ wordBreak: "break-all" }}>{data.link}</code>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(data.link);
                setCopied(true);
              }}
            >
              {copied ? `✓ ${dict.referral_copied}` : dict.referral_copy}
            </button>
          </p>
          <p className="muted">
            {data.commissionPercent}% · {data.orders} orders ·{" "}
            {dict.referral_earned}: {formatPrice(data.earnedUSD, currency, locale)} ·{" "}
            {dict.referral_pending}: {formatPrice(data.pendingUSD, currency, locale)}
          </p>
        </>
      )}
    </section>
  );
}
