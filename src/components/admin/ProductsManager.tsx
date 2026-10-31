"use client";

/**
 * Manager's Office — product manager (Phase 4 upgrade, item 4):
 * create / edit / archive / duplicate on top of the catalog resolver
 * (DB when configured, .data overlay otherwise — the API reports
 * which). Covers price + compare-at, per-product COST (feeds the
 * profit report), per-currency prices, categories, badges, content
 * language, scheduled publishing and per-locale translations.
 * Product FILES are attached in the files panel below (Phase-1
 * magic-byte pipeline), banners/covers derive from the product.
 */
import { useEffect, useState } from "react";

export interface ProductsDict {
  loading: string; saved: string; save: string; title: string; price: string; compareAt: string;
  cost: string; category: string; badge: string; language: string; publishAt: string;
  active: string; duplicate: string; create: string; slug: string; overrides: string;
  translations: string; addRow: string; none: string; source: string;
  subtitle: string; description: string;
}

interface ProductRow {
  id: string; slug: string; title: string; subtitle: string; description: string;
  category: string; priceUSD: number; compareAtUSD?: number; costUSD?: number;
  badge?: string; language?: string; publishAt?: string | null; rating: number;
  reviewsCount: number; active: boolean;
  priceOverrides?: Record<string, number>;
  translations?: Record<string, { title?: string; subtitle?: string; description?: string }>;
}

type Draft = ProductRow & {
  overrideRows: { code: string; value: string }[];
  translationRows: { locale: string; title: string; subtitle: string; description: string }[];
};

function toDraft(p: ProductRow): Draft {
  return {
    ...p,
    overrideRows: Object.entries(p.priceOverrides ?? {}).map(([code, value]) => ({ code, value: String(value) })),
    translationRows: Object.entries(p.translations ?? {}).map(([locale, t]) => ({
      locale, title: t.title ?? "", subtitle: t.subtitle ?? "", description: t.description ?? "",
    })),
  };
}

export default function ProductsManager({ dict, categories }: { dict: ProductsDict; categories: string[] }) {
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [source, setSource] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ slug: "", title: "", priceUSD: "", category: categories[0] ?? "ebooks" });

  async function load() {
    const res = await fetch("/api/admin/products");
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as { products: ProductRow[]; source: string };
    setProducts(d.products); setSource(d.source);
  }
  useEffect(() => { void load(); }, []);

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    const priceOverrides: Record<string, number> = {};
    for (const row of draft.overrideRows) {
      const code = row.code.trim().toUpperCase();
      const value = Number(row.value);
      if (/^[A-Z]{3}$/.test(code) && Number.isFinite(value) && value >= 0) priceOverrides[code] = value;
    }
    const translations: NonNullable<ProductRow["translations"]> = {};
    for (const row of draft.translationRows) {
      const locale = row.locale.trim();
      if (!locale) continue;
      translations[locale] = { title: row.title, subtitle: row.subtitle, description: row.description };
    }
    const res = await fetch("/api/admin/products", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: draft.id, title: draft.title, priceUSD: draft.priceUSD,
        compareAtUSD: draft.compareAtUSD ?? null, costUSD: draft.costUSD ?? 0,
        category: draft.category, badge: (draft.badge || null) as "bestseller" | "new" | null,
        language: draft.language || null,
        publishAt: draft.publishAt ? new Date(draft.publishAt).toISOString() : null,
        active: draft.active, priceOverrides, translations,
        subtitle: draft.subtitle, description: draft.description,
      }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
    setNotice(dict.saved);
    await load();
  }

  async function duplicate(p: ProductRow) {
    const res = await fetch("/api/admin/products", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "duplicate", sourceId: p.id }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
    setNotice(dict.saved);
    await load();
  }

  async function create() {
    const res = await fetch("/api/admin/products", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        product: { slug: createForm.slug, title: createForm.title, priceUSD: Number(createForm.priceUSD), category: createForm.category },
      }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
    setCreateForm({ slug: "", title: "", priceUSD: "", category: createForm.category });
    setNotice(dict.saved);
    await load();
  }

  if (!products) return <p className="muted">{error ?? dict.loading}</p>;
  return (
    <div>
      <p className="muted">{dict.source}: <strong>{source}</strong></p>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}
      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead><tr><th>{dict.title}</th><th>{dict.price}</th><th>{dict.cost}</th><th>{dict.category}</th><th>{dict.active}</th><th /></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td><td>${p.priceUSD}</td><td>${p.costUSD ?? 0}</td><td>{p.category}</td>
                <td>{p.active ? "✓" : "—"}</td>
                <td>
                  <span className="btn-row">
                    <button type="button" className="btn" onClick={() => setDraft(toDraft(p))}>✎</button>
                    <button type="button" className="btn" onClick={() => void duplicate(p)}>{dict.duplicate}</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft && (
        <form className="admin-form office-detail" onSubmit={(e) => { e.preventDefault(); void saveDraft(); }}>
          <h3>{draft.title} <code>({draft.id})</code></h3>
          <label>{dict.title}<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></label>
          <label>{dict.subtitle}<input value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} /></label>
          <label>{dict.description}<textarea value={draft.description} rows={4} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <label>{dict.slug}<input value={draft.slug} disabled /></label>
          <label>{dict.price} (USD)<input type="number" step="0.01" min="0" value={draft.priceUSD}
            onChange={(e) => setDraft({ ...draft, priceUSD: Number(e.target.value) })} /></label>
          <label>{dict.compareAt} (USD)<input type="number" step="0.01" min="0" value={draft.compareAtUSD ?? ""}
            onChange={(e) => setDraft({ ...draft, compareAtUSD: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
          <label>{dict.cost} (USD)<input type="number" step="0.01" min="0" value={draft.costUSD ?? 0}
            onChange={(e) => setDraft({ ...draft, costUSD: Number(e.target.value) })} /></label>
          <label>{dict.category}
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>{dict.badge}
            <select value={draft.badge ?? ""} onChange={(e) => setDraft({ ...draft, badge: e.target.value || undefined })}>
              <option value="">{dict.none}</option>
              <option value="bestseller">bestseller</option>
              <option value="new">new</option>
            </select>
          </label>
          <label>{dict.language}<input value={draft.language ?? ""} placeholder="en"
            onChange={(e) => setDraft({ ...draft, language: e.target.value || undefined })} /></label>
          <label>{dict.publishAt}<input type="datetime-local" value={draft.publishAt ? draft.publishAt.slice(0, 16) : ""}
            onChange={(e) => setDraft({ ...draft, publishAt: e.target.value || null })} /></label>
          <label className="office-check">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            {dict.active}
          </label>

          <h4>{dict.overrides}</h4>
          {draft.overrideRows.map((row, i) => (
            <span key={i} className="office-inline">
              <input value={row.code} placeholder="EUR" maxLength={3} onChange={(e) => {
                const rows = [...draft.overrideRows]; rows[i] = { ...row, code: e.target.value }; setDraft({ ...draft, overrideRows: rows });
              }} />
              <input type="number" step="0.01" min="0" value={row.value} onChange={(e) => {
                const rows = [...draft.overrideRows]; rows[i] = { ...row, value: e.target.value }; setDraft({ ...draft, overrideRows: rows });
              }} />
            </span>
          ))}
          <button type="button" className="btn" onClick={() => setDraft({ ...draft, overrideRows: [...draft.overrideRows, { code: "", value: "" }] })}>{dict.addRow}</button>

          <h4>{dict.translations}</h4>
          {draft.translationRows.map((row, i) => (
            <div key={i} className="office-detail">
              <label>Locale<input value={row.locale} placeholder="ar" maxLength={5} onChange={(e) => {
                const rows = [...draft.translationRows]; rows[i] = { ...row, locale: e.target.value }; setDraft({ ...draft, translationRows: rows });
              }} /></label>
              <label>{dict.title}<input value={row.title} onChange={(e) => {
                const rows = [...draft.translationRows]; rows[i] = { ...row, title: e.target.value }; setDraft({ ...draft, translationRows: rows });
              }} /></label>
              <label>{dict.subtitle}<input value={row.subtitle} onChange={(e) => {
                const rows = [...draft.translationRows]; rows[i] = { ...row, subtitle: e.target.value }; setDraft({ ...draft, translationRows: rows });
              }} /></label>
              <label>{dict.description}<textarea value={row.description} rows={3} onChange={(e) => {
                const rows = [...draft.translationRows]; rows[i] = { ...row, description: e.target.value }; setDraft({ ...draft, translationRows: rows });
              }} /></label>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setDraft({ ...draft, translationRows: [...draft.translationRows, { locale: "", title: "", subtitle: "", description: "" }] })}>{dict.addRow}</button>

          <div className="btn-row">
            <button type="submit" className="btn btn-primary">{dict.save}</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>✕</button>
          </div>
        </form>
      )}

      <form className="admin-form office-inline" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <label>{dict.slug}<input value={createForm.slug} onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })} required /></label>
        <label>{dict.title}<input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} required /></label>
        <label>{dict.price}<input type="number" step="0.01" min="0" value={createForm.priceUSD} onChange={(e) => setCreateForm({ ...createForm, priceUSD: e.target.value })} required /></label>
        <label>{dict.category}
          <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary">{dict.create}</button>
      </form>
    </div>
  );
}
