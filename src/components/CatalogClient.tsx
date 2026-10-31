"use client";
/**
 * Shop catalog (Phase 3 upgrade).
 *
 * Products arrive from the server page, which resolves them through
 * the Phase-1 catalog resolver (database-first) — this component never
 * touches the static seed. Filtering, curated collections and sorting
 * run through the pure helpers in lib/catalog-view (unit-tested).
 *
 * Layout: sidebar filters on desktop; on mobile the same filter block
 * opens as a bottom sheet. Grid/list view toggle. Instant search keeps
 * the Phase-3 smart-search ranker + suggestions.
 */
import { useMemo, useRef, useState } from "react";
import { productLanguage, type Product } from "../data/products";
import type { Dict } from "../i18n/dictionaries";
import { searchProducts, suggestProducts } from "../lib/search";
import { applyCollection, sortProducts, type CatalogSortKey, type CollectionId } from "../lib/catalog-view";
import ProductCard from "./ProductCard";

export default function CatalogClient({
  products,
  locale,
  dict,
  currency,
  initialQuery = "",
}: {
  products: Product[];
  locale: string;
  dict: Dict;
  currency: string;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<string>("all");
  const [format, setFormat] = useState<string>("all");
  const [language, setLanguage] = useState<string>("all");
  const [maxPrice, setMaxPrice] = useState<number>(200);
  const [minRating, setMinRating] = useState<number>(0);
  const [sort, setSort] = useState<CatalogSortKey>("featured");
  const [collection, setCollection] = useState<CollectionId>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [sugOpen, setSugOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formats = useMemo(
    () => Array.from(new Set(products.flatMap((p) => p.formats.map((f) => f.format)))),
    [products],
  );
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))), [products]);
  const languages = useMemo(() => Array.from(new Set(products.map((p) => productLanguage(p)))), [products]);

  const suggestions = useMemo(
    () => (sugOpen && debouncedQuery.trim() ? suggestProducts(debouncedQuery, 6, products) : []),
    [sugOpen, debouncedQuery, products],
  );

  const filtered = useMemo(() => {
    const inCollection = applyCollection(products, collection);
    if (query.trim()) {
      const filters = {
        category: category !== "all" ? category : undefined,
        format: format !== "all" ? format : undefined,
        language: language !== "all" ? language : undefined,
        maxPriceUSD: maxPrice,
        minRating,
      };
      return searchProducts(query, { filters, catalog: inCollection }).map((r) => r.product);
    }
    const list = inCollection.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (format !== "all" && !p.formats.some((f) => f.format === format)) return false;
      if (language !== "all" && productLanguage(p) !== language) return false;
      if (p.priceUSD > maxPrice) return false;
      if (p.rating < minRating) return false;
      return true;
    });
    return sortProducts(list, sort);
  }, [products, query, collection, category, format, language, maxPrice, minRating, sort]);

  const collectionLabels: { id: CollectionId; label: string }[] = [
    { id: "all", label: dict.filter_all },
    { id: "bestsellers", label: dict.sec_bestsellers },
    { id: "new", label: dict.sec_new },
    { id: "under25", label: dict.col_under25 },
    { id: "toprated", label: dict.col_toprated },
  ];

  const filtersBlock = (
    <div className="catalog-filters-block">
      <p className="filters-heading">{dict.collections_t}</p>
      <div className="filter-chips" role="group" aria-label={dict.collections_t}>
        {collectionLabels.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip ${collection === c.id ? "chip-on" : ""}`}
            aria-pressed={collection === c.id}
            onClick={() => setCollection(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="filters-heading">{dict.sec_categories}</p>
      <div className="filter-chips" role="group" aria-label={dict.sec_categories}>
        <button type="button" className={`chip ${category === "all" ? "chip-on" : ""}`} onClick={() => setCategory("all")}>
          {dict.filter_all}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" className={`chip ${category === c ? "chip-on" : ""}`} onClick={() => setCategory(c)}>
            {dict[`cat_${c}`] ?? c}
          </button>
        ))}
      </div>
      <label className="filter-field">
        {dict.filter_format}
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="all">{dict.filter_all}</option>
          {formats.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        {dict.filter_price}: ≤ ${maxPrice}
        <input type="range" min={9} max={200} step={1} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} />
      </label>
      <label className="filter-field">
        {dict.filter_language}
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="all">{dict.filter_all}</option>
          {languages.map((l) => (
            <option key={l} value={l}>{l.toUpperCase()}</option>
          ))}
        </select>
      </label>
      <label className="filter-field">
        {dict.filter_rating}
        <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
          <option value={0}>{dict.filter_all}</option>
          <option value={4.7}>4.7+</option>
          <option value={4.8}>4.8+</option>
          <option value={4.9}>4.9</option>
        </select>
      </label>
    </div>
  );

  return (
    <div className="catalog">
      <div className="catalog-tools">
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => setDebouncedQuery(e.target.value), 180);
              setSugOpen(true);
            }}
            onFocus={() => setSugOpen(true)}
            onBlur={() => setTimeout(() => setSugOpen(false), 150)}
            placeholder={dict.search_placeholder}
            aria-label={dict.search_placeholder}
            className="search-input"
            style={{ width: "100%" }}
          />
          {suggestions.length > 0 && (
            <ul
              className="panel"
              style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: "calc(100% + 6px)", zIndex: 30, listStyle: "none", margin: 0, padding: 6 }}
              role="listbox"
              aria-label={dict.search_placeholder}
            >
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ width: "100%", textAlign: "start", justifyContent: "flex-start" }}
                    onClick={() => { setQuery(s.title); setDebouncedQuery(s.title); setSugOpen(false); }}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="filter-inline">
          {dict.sort_t}
          <select value={sort} onChange={(e) => setSort(e.target.value as CatalogSortKey)}>
            <option value="featured">{dict.sort_featured}</option>
            <option value="popularity">{dict.sort_popularity}</option>
            <option value="price-asc">{dict.sort_price_asc}</option>
            <option value="price-desc">{dict.sort_price_desc}</option>
            <option value="rating">{dict.sort_rating}</option>
            <option value="newest">{dict.sort_newest}</option>
          </select>
        </label>
        <div className="view-toggle" role="group" aria-label={dict.view_grid}>
          <button type="button" className={`icon-btn ${view === "grid" ? "view-on" : ""}`} aria-label={dict.view_grid} aria-pressed={view === "grid"} onClick={() => setView("grid")}>▦</button>
          <button type="button" className={`icon-btn ${view === "list" ? "view-on" : ""}`} aria-label={dict.view_list} aria-pressed={view === "list"} onClick={() => setView("list")}>☰</button>
        </div>
        <button type="button" className="btn filters-open-btn" onClick={() => setSheetOpen(true)}>
          {dict.filters_t}
        </button>
      </div>

      <div className="catalog-layout">
        <aside className="catalog-sidebar">{filtersBlock}</aside>
        <div className="catalog-results">
          <p className="muted">{filtered.length} {dict.results}</p>
          {filtered.length === 0 ? (
            <p className="empty-note">{dict.no_results}</p>
          ) : (
            <div className={view === "list" ? "grid catalog-list" : "grid"}>
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} locale={locale} dict={dict} currency={currency} />
              ))}
            </div>
          )}
        </div>
      </div>

      {sheetOpen && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setSheetOpen(false)}>
          <div
            className="filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={dict.filters_t}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <strong>{dict.filters_t}</strong>
              <button type="button" className="icon-btn" aria-label={dict.quick_close} onClick={() => setSheetOpen(false)}>✕</button>
            </div>
            {filtersBlock}
            <button type="button" className="btn btn-grad" style={{ width: "100%" }} onClick={() => setSheetOpen(false)}>
              {dict.filters_apply} · {filtered.length}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
