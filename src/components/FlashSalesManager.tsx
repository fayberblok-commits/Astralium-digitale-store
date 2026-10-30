"use client";
/**
 * Admin flash-sales manager (Phase 4, feature 9): create/edit campaigns
 * (product ids, discount %, start/end, optional quantity cap, active).
 * Prices shown anywhere are derived server-side; this panel only edits
 * campaign definitions. State (scheduled/active/ended/sold-out) comes
 * from the API's server-side state machine.
 */
import { useCallback, useEffect, useState } from "react";

export interface FlashDict {
  name: string; discount: string; products: string; start: string; end: string;
  cap: string; active: string; save: string; delete: string; state: string;
}

interface Sale {
  id: string; name: string; productIds: string[]; discountPercent: number;
  startsAt: string; endsAt: string; quantityCap: number | null;
  soldCount: number; active: boolean; state?: string;
}

export default function FlashSalesManager({ dict }: { dict: FlashDict }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [name, setName] = useState("");
  const [products, setProducts] = useState("");
  const [discount, setDiscount] = useState(25);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [cap, setCap] = useState("");
  const [active, setActive] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/flash-sales");
      if (!res.ok) return;
      const data = (await res.json()) as { sales: Sale[] };
      setSales(data.sales ?? []);
    } catch { /* empty list */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function edit(sale: Sale) {
    setEditId(sale.id);
    setName(sale.name);
    setProducts(sale.productIds.join(","));
    setDiscount(sale.discountPercent);
    setStart(sale.startsAt.slice(0, 16));
    setEnd(sale.endsAt.slice(0, 16));
    setCap(sale.quantityCap === null ? "" : String(sale.quantityCap));
    setActive(sale.active);
  }

  async function save() {
    setError(null);
    const res = await fetch("/api/admin/flash-sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sale: {
          id: editId ?? undefined,
          name: name || "Flash sale",
          productIds: products.split(",").map((s) => s.trim()).filter(Boolean),
          discountPercent: discount,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
          quantityCap: cap === "" ? null : Number(cap),
          active,
        },
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "ERROR");
      return;
    }
    setEditId(null);
    setName("");
    setProducts("");
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/admin/flash-sales?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <table className="admin-table">
        <thead>
          <tr><th>{dict.name}</th><th>{dict.discount}</th><th>{dict.products}</th><th>{dict.start}</th><th>{dict.end}</th><th>{dict.state}</th><th></th></tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>−{s.discountPercent}%</td>
              <td>{s.productIds.join(", ")}</td>
              <td>{s.startsAt.slice(0, 16).replace("T", " ")}</td>
              <td>{s.endsAt.slice(0, 16).replace("T", " ")}</td>
              <td>
                <span className={`pill ${s.state === "active" ? "pill-ok" : ""}`}>{s.state ?? "—"}</span>{" "}
                <span className="muted">{s.soldCount}{s.quantityCap !== null ? `/${s.quantityCap}` : ""}</span>
              </td>
              <td>
                <button type="button" className="btn btn-ghost" onClick={() => edit(s)}>✎</button>{" "}
                <button type="button" className="btn btn-ghost" onClick={() => void remove(s.id)}>{dict.delete}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14, maxWidth: 560 }}>
        <label>{dict.name}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{dict.products}<input value={products} onChange={(e) => setProducts(e.target.value)} placeholder="p01,p02" /></label>
        <label>{dict.discount}<input type="number" min={1} max={90} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></label>
        <label>{dict.start}<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>{dict.end}<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>{dict.cap}<input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="∞" /></label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {dict.active}
        </label>
        {error && <p className="err-text" role="alert">{error}</p>}
        <p><button type="button" className="btn btn-primary" onClick={() => void save()}>{dict.save}</button></p>
      </div>
    </div>
  );
}
