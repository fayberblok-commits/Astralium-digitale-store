"use client";
/**
 * Admin commerce manager (Phase 4, features 11–15): one panel for the
 * JSON-backed configs — PWYW (min/suggested per product), pre-order
 * release dates, subscription plans (interval + price), loyalty rates
 * and the referral commission %. Plus the recorded-commissions table
 * (feature 12 — payouts are manual/recorded-only, stated in the UI).
 * Everything is re-sanitized server-side against the catalog on save.
 */
import { useEffect, useState } from "react";

export interface CommerceDict {
  save: string; saved: string;
  pwywFor: string; pwywMin: string; pwywSuggested: string;
  preorderDate: string; planInterval: string; planPrice: string;
  loyaltyEarn: string; loyaltyMax: string; referralPercent: string;
  commissionsTitle: string; commissionsEmpty: string;
}

interface CommerceData {
  pwyw: Record<string, { minUSD: number; suggestedUSD: number; tiers: { priceUSD: number; label: string; bonus: string }[] }>;
  preorders: Record<string, { releaseDate: string }>;
  loyalty: { earnPerUSD: number; maxRedeemPercent: number; pointValueUSD: number; expiryDays: number; tiers: { name: string; minLifetime: number; multiplier: number }[] };
  referrals: { commissionPercent: number };
  plans: Record<string, { interval: "month" | "year"; priceUSD: number }>;
}

interface Commission {
  id: string; orderId: string; code: string; commissionPercent: number;
  orderTotalUSD: number; commissionUSD: number; status: string; createdAt: string;
}

export default function CommerceManager({
  dict,
  products,
}: {
  dict: CommerceDict;
  products: { id: string; title: string }[];
}) {
  const [data, setData] = useState<CommerceData | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [forProduct, setForProduct] = useState(products[0]?.id ?? "");
  const [pwywMin, setPwywMin] = useState("");
  const [pwywSuggested, setPwywSuggested] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [planInterval, setPlanInterval] = useState<"month" | "year">("month");
  const [planPrice, setPlanPrice] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/commerce");
        if (res.ok) setData((await res.json()) as CommerceData);
        const res2 = await fetch("/api/admin/referrals");
        if (res2.ok) {
          const d2 = (await res2.json()) as { commissions: Commission[] };
          setCommissions(d2.commissions ?? []);
        }
      } catch { /* empty config */ }
    })();
  }, []);

  useEffect(() => {
    if (!data) return;
    setPwywMin(data.pwyw[forProduct] ? String(data.pwyw[forProduct].minUSD) : "");
    setPwywSuggested(data.pwyw[forProduct] ? String(data.pwyw[forProduct].suggestedUSD) : "");
    setReleaseDate(data.preorders[forProduct]?.releaseDate?.slice(0, 10) ?? "");
    setPlanInterval(data.plans[forProduct]?.interval ?? "month");
    setPlanPrice(data.plans[forProduct] ? String(data.plans[forProduct].priceUSD) : "");
  }, [forProduct, data]);

  async function save(next: CommerceData) {
    const res = await fetch("/api/admin/commerce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      setData((await res.json()) as CommerceData);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  function saveProduct() {
    if (!data) return;
    const next: CommerceData = JSON.parse(JSON.stringify(data)) as CommerceData;
    const min = Number(pwywMin);
    if (pwywMin !== "" && Number.isFinite(min) && min > 0) {
      const tiers = next.pwyw[forProduct]?.tiers ?? [];
      next.pwyw[forProduct] = {
        minUSD: min,
        suggestedUSD: Math.max(min, Number(pwywSuggested) || min),
        tiers: tiers.filter((t) => t.priceUSD >= min),
      };
    } else {
      delete next.pwyw[forProduct];
    }
    if (releaseDate) {
      next.preorders[forProduct] = { releaseDate: new Date(`${releaseDate}T00:00:00.000Z`).toISOString() };
    } else {
      delete next.preorders[forProduct];
    }
    const price = Number(planPrice);
    if (planPrice !== "" && Number.isFinite(price) && price > 0) {
      next.plans[forProduct] = { interval: planInterval, priceUSD: price };
    } else {
      delete next.plans[forProduct];
    }
    void save(next);
  }

  if (!data) return <p className="muted">…</p>;
  return (
    <div>
      <label>
        {dict.pwywFor}
        <select value={forProduct} onChange={(e) => setForProduct(e.target.value)}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 560, marginTop: 10 }}>
        <label>
          {dict.pwywMin}
          <span style={{ display: "flex", gap: 8 }}>
            <input type="number" min={0} step="0.5" value={pwywMin} onChange={(e) => setPwywMin(e.target.value)} placeholder="min" />
            <input type="number" min={0} step="0.5" value={pwywSuggested} onChange={(e) => setPwywSuggested(e.target.value)} placeholder={dict.pwywSuggested} />
          </span>
        </label>
        <label>
          {dict.preorderDate}
          <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
        </label>
        <label>
          {dict.planInterval}
          <span style={{ display: "flex", gap: 8 }}>
            <select value={planInterval} onChange={(e) => setPlanInterval(e.target.value as "month" | "year")}>
              <option value="month">month</option>
              <option value="year">year</option>
            </select>
            <input type="number" min={0} step="0.5" value={planPrice} onChange={(e) => setPlanPrice(e.target.value)} placeholder={dict.planPrice} />
          </span>
        </label>
        <p><button type="button" className="btn btn-primary" onClick={saveProduct}>{dict.save}</button></p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 560, marginTop: 18 }}>
        <label>
          {dict.loyaltyEarn}
          <span style={{ display: "flex", gap: 8 }}>
            <input
              type="number" min={0} step="0.5"
              value={data.loyalty.earnPerUSD}
              onChange={(e) => setData({ ...data, loyalty: { ...data.loyalty, earnPerUSD: Number(e.target.value) } })}
            />
            <input
              type="number" min={0} max={90} step={1}
              value={data.loyalty.maxRedeemPercent}
              onChange={(e) => setData({ ...data, loyalty: { ...data.loyalty, maxRedeemPercent: Number(e.target.value) } })}
              placeholder={dict.loyaltyMax}
            />
          </span>
        </label>
        <label>
          {dict.referralPercent}
          <input
            type="number" min={0} max={50} step={0.5}
            value={data.referrals.commissionPercent}
            onChange={(e) => setData({ ...data, referrals: { commissionPercent: Number(e.target.value) } })}
          />
        </label>
        <p>
          <button type="button" className="btn btn-primary" onClick={() => void save(data)}>{dict.save}</button>{" "}
          {saved && <span className="ok-text">{dict.saved}</span>}
        </p>
      </div>

      <h3>{dict.commissionsTitle}</h3>
      {commissions.length === 0 ? (
        <p className="empty-note">{dict.commissionsEmpty}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>Order</th><th>Code</th><th>%</th><th>Total</th><th>Commission</th><th>Status</th></tr>
          </thead>
          <tbody>
            {commissions.map((c) => (
              <tr key={c.id}>
                <td>{c.orderId}</td>
                <td><code>{c.code}</code></td>
                <td>{c.commissionPercent}%</td>
                <td>${c.orderTotalUSD.toFixed(2)}</td>
                <td>${c.commissionUSD.toFixed(2)}</td>
                <td><span className={`pill ${c.status === "earned" ? "pill-ok" : ""}`}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
