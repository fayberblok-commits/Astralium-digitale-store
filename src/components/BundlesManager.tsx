"use client";
/**
 * Admin bundles manager (Phase 3, feature 3): list/create/edit/delete
 * owner bundles. Prices shown are the server-derived ones (catalog sum
 * minus discount) returned by the API — never computed from typed input.
 */
import { useCallback, useEffect, useState } from "react";

export interface BundlesDict {
  name: string; discount: string; products: string; active: string;
  save: string; delete: string; derived: string;
}

interface Row {
  id: string; title: string; description: string; productIds: string[];
  discountPercent: number; active: boolean;
  derived?: { sumUSD: number; priceUSD: number; savingsUSD: number };
}

export default function BundlesManager({ dict }: { dict: BundlesDict }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [discount, setDiscount] = useState(15);
  const [productIds, setProductIds] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bundles");
      if (!res.ok) return;
      const data = (await res.json()) as { bundles: Row[] };
      setRows(data.bundles);
    } catch { /* panel stays empty */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setMsg(null);
    const res = await fetch("/api/admin/bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        discountPercent: discount,
        productIds: productIds.split(",").map((s) => s.trim()).filter(Boolean),
        active: true,
      }),
    });
    if (res.ok) { setTitle(""); setProductIds(""); void load(); }
    else { const d = (await res.json().catch(() => ({}))) as { error?: string }; setMsg(d.error ?? "error"); }
  }

  async function remove(id: string) {
    await fetch(`/api/admin/bundles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void load();
  }

  async function toggleActive(row: Row) {
    await fetch("/api/admin/bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, title: row.title, description: row.description, productIds: row.productIds, discountPercent: row.discountPercent, active: !row.active }),
    });
    void load();
  }

  return (
    <div>
      {rows.map((r) => (
        <p key={r.id} className="summary-row">
          <span>
            <strong>{r.title}</strong> · {r.productIds.join(", ")} · −{r.discountPercent}% ·{" "}
            {dict.derived}: ${r.derived?.priceUSD ?? "—"}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={() => void toggleActive(r)}>{dict.active}: {r.active ? "✓" : "—"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => void remove(r.id)}>{dict.delete}</button>
          </span>
        </p>
      ))}
      <div className="checkout-form" style={{ marginTop: 12 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={dict.name} aria-label={dict.name} />
        <input value={productIds} onChange={(e) => setProductIds(e.target.value)} placeholder={dict.products} aria-label={dict.products} />
        <label>
          {dict.discount}
          <input type="number" min={0} max={90} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
        </label>
        {msg && <p className="err-text" role="alert">{msg}</p>}
        <button type="button" className="btn btn-primary" onClick={() => void save()}>{dict.save}</button>
      </div>
    </div>
  );
}
