"use client";

/**
 * Manager's Office — coupons & discounts (Phase 4 upgrade, item 6).
 * The list is office-managed data (lib/coupons-store.ts): checkout and
 * the validation endpoint evaluate against exactly what is shown here.
 */
import { useEffect, useState } from "react";

export interface CouponsDict {
  loading: string; saved: string; code: string; type: string; percent: string; fixed: string;
  value: string; min: string; add: string; active: string;
}

interface CouponRow {
  code: string; type: "percent" | "fixed"; value: number; active: boolean;
  firstOrderOnly?: boolean; minSubtotalUSD?: number; usageLimit?: number;
  countries?: string[]; productIds?: string[];
}

export default function CouponsPanel({ dict }: { dict: CouponsDict }) {
  const [coupons, setCoupons] = useState<CouponRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", type: "percent" as "percent" | "fixed", value: "", min: "", firstOrderOnly: false });

  async function load() {
    const res = await fetch("/api/admin/office/coupons");
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as { coupons: CouponRow[] };
    setCoupons(d.coupons);
  }
  useEffect(() => { void load(); }, []);

  async function post(body: unknown) {
    const res = await fetch("/api/admin/office/coupons", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string; coupons?: CouponRow[] };
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
    if (d.coupons) setCoupons(d.coupons);
    setNotice(dict.saved);
  }

  if (!coupons) return <p className="muted">{error ?? dict.loading}</p>;
  return (
    <div>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}
      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead><tr><th>{dict.code}</th><th>{dict.type}</th><th>{dict.value}</th><th>{dict.min}</th><th>{dict.active}</th><th /></tr></thead>
          <tbody>
            {coupons.map((c) => (
              <tr key={c.code}>
                <td><code>{c.code}</code></td><td>{c.type}</td>
                <td>{c.type === "percent" ? `${c.value}%` : `$${c.value}`}</td>
                <td>{c.minSubtotalUSD ? `$${c.minSubtotalUSD}` : "—"}</td>
                <td>{c.active ? "✓" : "—"}</td>
                <td>
                  <span className="btn-row">
                    <button type="button" className="btn" onClick={() => void post({ action: "toggle", code: c.code, active: !c.active })}>
                      {c.active ? "⏸" : "▶"}
                    </button>
                    <button type="button" className="btn" onClick={() => void post({ action: "delete", code: c.code })}>✕</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="admin-form office-inline" onSubmit={(e) => {
        e.preventDefault();
        void post({
          action: "upsert",
          coupon: {
            code: form.code, type: form.type, value: Number(form.value), active: true,
            firstOrderOnly: form.firstOrderOnly,
            minSubtotalUSD: form.min === "" ? undefined : Number(form.min),
          },
        });
        setForm({ code: "", type: "percent", value: "", min: "", firstOrderOnly: false });
      }}>
        <label>{dict.code}<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required maxLength={40} /></label>
        <label>{dict.type}
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "percent" | "fixed" })}>
            <option value="percent">{dict.percent}</option>
            <option value="fixed">{dict.fixed}</option>
          </select>
        </label>
        <label>{dict.value}<input type="number" step="0.01" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required /></label>
        <label>{dict.min}<input type="number" step="0.01" min="0" value={form.min} onChange={(e) => setForm({ ...form, min: e.target.value })} /></label>
        <button type="submit" className="btn btn-primary">{dict.add}</button>
      </form>
    </div>
  );
}
