"use client";
/**
 * Admin offers manager (Phase 3, feature 4): one JSON-backed config —
 * per product, a bump slot and an upsell slot (product id + discount %).
 * The server sanitizes every id/percent before persisting.
 */
import { useEffect, useState } from "react";

export interface OffersDict {
  product: string; bump: string; upsell: string; save: string; saved: string;
}

type Config = Record<string, { bump?: { productId: string; discountPercent: number }; upsell?: { productId: string; discountPercent: number } }>;

export default function OffersManager({
  dict,
  products,
}: {
  dict: OffersDict;
  products: { id: string; title: string }[];
}) {
  const [config, setConfig] = useState<Config>({});
  const [forProduct, setForProduct] = useState(products[0]?.id ?? "");
  const [bumpId, setBumpId] = useState("");
  const [bumpPct, setBumpPct] = useState(20);
  const [upsellId, setUpsellId] = useState("");
  const [upsellPct, setUpsellPct] = useState(25);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/offers");
        if (!res.ok) return;
        const data = (await res.json()) as { config: Config };
        setConfig(data.config ?? {});
      } catch { /* empty config */ }
    })();
  }, []);

  useEffect(() => {
    const cur = config[forProduct];
    setBumpId(cur?.bump?.productId ?? "");
    setBumpPct(cur?.bump?.discountPercent ?? 20);
    setUpsellId(cur?.upsell?.productId ?? "");
    setUpsellPct(cur?.upsell?.discountPercent ?? 25);
  }, [forProduct, config]);

  async function save() {
    const next: Config = { ...config };
    const entry: Config[string] = {};
    if (bumpId) entry.bump = { productId: bumpId, discountPercent: bumpPct };
    if (upsellId) entry.upsell = { productId: upsellId, discountPercent: upsellPct };
    if (entry.bump || entry.upsell) next[forProduct] = entry; else delete next[forProduct];
    const res = await fetch("/api/admin/offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: next }),
    });
    if (res.ok) {
      const data = (await res.json()) as { config: Config };
      setConfig(data.config);
      setSaved(true);
    }
  }

  const productSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">—</option>
      {products.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
    </select>
  );

  return (
    <div className="checkout-form">
      <label>
        {dict.product}
        <select value={forProduct} onChange={(e) => setForProduct(e.target.value)}>
          {products.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
        </select>
      </label>
      <label>
        {dict.bump}
        {productSelect(bumpId, setBumpId, dict.bump)}
        <input type="number" min={0} max={90} value={bumpPct} onChange={(e) => setBumpPct(Number(e.target.value))} aria-label="%" />
      </label>
      <label>
        {dict.upsell}
        {productSelect(upsellId, setUpsellId, dict.upsell)}
        <input type="number" min={0} max={90} value={upsellPct} onChange={(e) => setUpsellPct(Number(e.target.value))} aria-label="%" />
      </label>
      <button type="button" className="btn btn-primary" onClick={() => void save()}>{dict.save}</button>
      {saved && <p className="ok-text" role="status">{dict.saved}</p>}
    </div>
  );
}
