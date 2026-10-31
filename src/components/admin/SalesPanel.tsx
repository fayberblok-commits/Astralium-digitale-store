"use client";

/**
 * Manager's Office — sales & profit (Phase 4 upgrade, item 2).
 * Renders the ledger-computed report from /api/admin/office/sales
 * (owner + accountant only — the API enforces `finance`). Fees/taxes
 * are labelled estimates; the panel edits those rates and the ad
 * spend log that feed the profit figure.
 */
import { useCallback, useEffect, useState } from "react";

export interface SalesDict {
  loading: string; gross: string; netProfit: string; refunds: string; fees: string; taxes: string;
  costs: string; adspend: string; fulfilled: string; pending: string; cancelled: string;
  refunded: string; disputed: string; byProduct: string; byCountry: string; byLanguage: string;
  byCurrency: string; prev: string; csv: string; feeSettings: string; estimatesNote: string;
  from: string; to: string; apply: string; adspendAdd: string; units: string; saved: string;
}

interface ProductRow { productId: string; orders: number; revenueUSD: number; refundsUSD: number; costUSD: number; profitUSD: number }
interface DimensionRow { key: string; orders: number; revenueUSD: number }
interface Report {
  counts: { fulfilled: number; pending: number; cancelled: number; refunded: number; disputed: number; total: number };
  grossUSD: number; refundsUSD: number;
  feesUSD: number; taxesUSD: number; productCostsUSD: number; adSpendUSD: number; netProfitUSD: number;
  byProduct: ProductRow[];
  byCountry: DimensionRow[];
  byLanguage: DimensionRow[];
  byCurrency: DimensionRow[];
  reconciliation: { itemsRevenueUSD: number; discountGapUSD: number; grossUSD: number; balanced: boolean };
}
interface Settings { stripeFeePercent: number; stripeFeeFixedUSD: number; paypalFeePercent: number; paypalFeeFixedUSD: number; taxPercent: number }
interface AdEntry { id: string; date: string; amountUSD: number; label: string }
interface SalesData {
  range: { fromISO: string; toISO: string };
  settings: Settings;
  adSpend: AdEntry[];
  report: Report;
  previous: { grossUSD: number; netProfitUSD: number; fulfilled: number };
}

const money = (n: number) => `$${n.toFixed(2)}`;
const dayInput = (iso: string) => iso.slice(0, 10);

export default function SalesPanel({ dict }: { dict: SalesDict }) {
  const [from, setFrom] = useState(() => dayInput(new Date(Date.now() - 29 * 86400000).toISOString()));
  const [to, setTo] = useState(() => dayInput(new Date().toISOString()));
  const [data, setData] = useState<SalesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [adDate, setAdDate] = useState(() => dayInput(new Date().toISOString()));
  const [adAmount, setAdAmount] = useState("");
  const [adLabel, setAdLabel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (f: string, t: string) => {
    setError(null);
    const res = await fetch(`/api/admin/office/sales?from=${f}&to=${t}`);
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as SalesData;
    setData(d);
    setSettings(d.settings);
  }, []);

  useEffect(() => { void load(from, to); /* initial range only */ }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: unknown) {
    const res = await fetch("/api/admin/office/sales", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { setError(`HTTP ${res.status}`); return false; }
    setNotice(dict.saved);
    await load(from, to);
    return true;
  }

  if (!data || !settings) return <p className="muted">{error ?? dict.loading}</p>;
  const r = data.report;
  const delta = (cur: number, prev: number) => (prev === 0 ? "—" : `${cur >= prev ? "▲" : "▼"} ${money(Math.abs(cur - prev))}`);

  const productTable = (
    <div>
      <h3>{dict.byProduct}</h3>
      {r.byProduct.length === 0 ? <p className="muted">—</p> : (
        <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead><tr><th>{dict.byProduct}</th><th>{dict.units}</th><th>{dict.gross}</th><th>{dict.refunds}</th><th>{dict.costs}</th><th>{dict.netProfit}</th></tr></thead>
          <tbody>
            {r.byProduct.map((row) => (
              <tr key={row.productId}>
                <td>{row.productId}</td><td>{row.orders}</td>
                <td>{money(row.revenueUSD)}</td><td>{money(row.refundsUSD)}</td><td>{money(row.costUSD)}</td><td>{money(row.profitUSD)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
  const dimensionTable = (title: string, rows: DimensionRow[]) => (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="muted">—</p> : (
        <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead><tr><th>{title}</th><th>{dict.units}</th><th>{dict.gross}</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}><td>{row.key}</td><td>{row.orders}</td><td>{money(row.revenueUSD)}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <form className="admin-form office-inline" onSubmit={(e) => { e.preventDefault(); void load(from, to); }}>
        <label>{dict.from}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{dict.to}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="submit" className="btn">{dict.apply}</button>
        <a className="btn" href={`/api/admin/office/sales?from=${from}&to=${to}&format=csv`}>{dict.csv}</a>
      </form>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}

      <div className="admin-grid">
        <div className="stat-card"><span className="muted">{dict.gross}</span><strong>{money(r.grossUSD)}</strong>
          <span className="muted">{dict.prev}: {money(data.previous.grossUSD)} ({delta(r.grossUSD, data.previous.grossUSD)})</span></div>
        <div className="stat-card"><span className="muted">{dict.netProfit}</span><strong>{money(r.netProfitUSD)}</strong>
          <span className="muted">{dict.prev}: {money(data.previous.netProfitUSD)} ({delta(r.netProfitUSD, data.previous.netProfitUSD)})</span></div>
        <div className="stat-card"><span className="muted">{dict.refunds}</span><strong>{money(r.refundsUSD)}</strong></div>
        <div className="stat-card"><span className="muted">{dict.fees}</span><strong>{money(r.feesUSD)}</strong></div>
        <div className="stat-card"><span className="muted">{dict.taxes}</span><strong>{money(r.taxesUSD)}</strong></div>
        <div className="stat-card"><span className="muted">{dict.costs}</span><strong>{money(r.productCostsUSD)}</strong></div>
        <div className="stat-card"><span className="muted">{dict.adspend}</span><strong>{money(r.adSpendUSD)}</strong></div>
        <div className="stat-card"><span className="muted">{dict.fulfilled} / {dict.pending} / {dict.cancelled} / {dict.refunded} / {dict.disputed}</span>
          <strong>{r.counts.fulfilled} / {r.counts.pending} / {r.counts.cancelled} / {r.counts.refunded} / {r.counts.disputed}</strong></div>
      </div>

      <div className="office-cols">
        {productTable}
        <div>
          {dimensionTable(dict.byCountry, r.byCountry)}
          {dimensionTable(dict.byLanguage, r.byLanguage)}
          {dimensionTable(dict.byCurrency, r.byCurrency)}
        </div>
      </div>

      <h3>{dict.feeSettings}</h3>
      <p className="muted">{dict.estimatesNote}</p>
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void post({ action: "settings", settings }); }}>
        <label>Stripe %<input type="number" step="0.01" min="0" max="30" value={settings.stripeFeePercent}
          onChange={(e) => setSettings({ ...settings, stripeFeePercent: Number(e.target.value) })} /></label>
        <label>Stripe $<input type="number" step="0.01" min="0" max="100" value={settings.stripeFeeFixedUSD}
          onChange={(e) => setSettings({ ...settings, stripeFeeFixedUSD: Number(e.target.value) })} /></label>
        <label>PayPal %<input type="number" step="0.01" min="0" max="30" value={settings.paypalFeePercent}
          onChange={(e) => setSettings({ ...settings, paypalFeePercent: Number(e.target.value) })} /></label>
        <label>PayPal $<input type="number" step="0.01" min="0" max="100" value={settings.paypalFeeFixedUSD}
          onChange={(e) => setSettings({ ...settings, paypalFeeFixedUSD: Number(e.target.value) })} /></label>
        <label>Tax %<input type="number" step="0.01" min="0" max="100" value={settings.taxPercent}
          onChange={(e) => setSettings({ ...settings, taxPercent: Number(e.target.value) })} /></label>
        <button type="submit" className="btn btn-primary">{dict.apply}</button>
      </form>

      <h3>{dict.adspend}</h3>
      <form className="admin-form office-inline" onSubmit={(e) => {
        e.preventDefault();
        const amountUSD = Number(adAmount);
        if (!(amountUSD > 0)) return;
        void post({ action: "adspend.add", entry: { date: adDate, amountUSD, label: adLabel } });
        setAdAmount(""); setAdLabel("");
      }}>
        <label>{dict.from}<input type="date" value={adDate} onChange={(e) => setAdDate(e.target.value)} /></label>
        <label>USD<input type="number" step="0.01" min="0" value={adAmount} onChange={(e) => setAdAmount(e.target.value)} required /></label>
        <label>Label<input type="text" value={adLabel} onChange={(e) => setAdLabel(e.target.value)} maxLength={120} /></label>
        <button type="submit" className="btn">{dict.adspendAdd}</button>
      </form>
      {data.adSpend.length > 0 && (
        <table className="admin-table">
          <tbody>
            {data.adSpend.map((a) => (
              <tr key={a.id}><td>{a.date}</td><td>{money(a.amountUSD)}</td><td>{a.label}</td>
                <td><button type="button" className="btn" onClick={() => void post({ action: "adspend.remove", id: a.id })}>✕</button></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
