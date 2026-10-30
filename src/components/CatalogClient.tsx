"use client";
import { useMemo, useRef, useState } from "react";
import { productLanguage, type Product } from "../data/products";
import type { Dict } from "../i18n/dictionaries";
import { searchProducts, suggestProducts } from "../lib/search";
import ProductCard from "./ProductCard";

type SortKey = "featured" | "price-asc" | "price-desc" | "rating" | "newest";

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
  const [sort, setSort] = useState<SortKey>("featured");
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
    const filters = {
      category: category !== "all" ? category : undefined,
      format: format !== "all" ? format : undefined,
      language: language !== "all" ? language : undefined,
      maxPriceUSD: maxPrice,
      minRating,
    };
    // With a query, the smart-search ranker decides order (typo-tolerant,
    // title hits first); without one, plain filtering + chosen sort.
    if (query.trim()) {
      return searchProducts(query, { filters, catalog: products }).map((r) => r.product);
    }
    let list = products.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (format !== "all" && !p.formats.some((f) => f.format === format)) return false;
      if (language !== "all" && productLanguage(p) !== language) return false;
      if (p.priceUSD > maxPrice) return false;
      if (p.rating < minRating) return false;
      return true;
    });
    switch (sort) {
      case "price-asc": list = [...list].sort((a, b) => a.priceUSD - b.priceUSD); break;
      case "price-desc": list = [...list].sort((a, b) => b.priceUSD - a.priceUSD); break;
      case "rating": list = [...list].sort((a, b) => b.rating - a.rating); break;
      case "newest": list = [...list].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)); break;
      default: list = [...list].sort((a, b) => (b.badge === "bestseller" ? 1 : 0) - (a.badge === "bestseller" ? 1 : 0));
    }
    return list;
  }, [products, query, category, format, language, maxPrice, minRating, sort]);

  return (
    <div className="catalog">
      <div className="catalog-tools">
        <div style={{ position: "relative", flex: 1 }}>
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
        <label>
          {dict.sort_t}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="featured">{dict.sort_featured}</option>
            <option value="price-asc">{dict.sort_price_asc}</option>
            <option value="price-desc">{dict.sort_price_desc}</option>
            <option value="rating">{dict.sort_rating}</option>
            <option value="newest">{dict.sort_newest}</option>
          </select>
        </label>
      </div>
      <div className="catalog-filters" role="group" aria-label="Filters">
        <button type="button" className={`chip ${category === "all" ? "chip-on" : ""}`} onClick={() => setCategory("all")}>
          {dict.filter_all}
        </button>
        {categories.map((c) => (
          <button key={c} type="button" className={`chip ${category === c ? "chip-on" : ""}`} onClick={() => setCategory(c)}>
            {dict[`cat_${c}`] ?? c}
          </button>
        ))}
        <label className="filter-inline">
          {dict.filter_format}
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="all">{dict.filter_all}</option>
            {formats.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="filter-inline">
          {dict.filter_price}: ≤ ${maxPrice}
          <input type="range" min={9} max={200} step={1} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} />
        </label>
        <label className="filter-inline">
          {dict.filter_language}
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="all">{dict.filter_all}</option>
            {languages.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <label className="filter-inline">
          {dict.filter_rating}
          <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
            <option value={0}>{dict.filter_all}</option>
            <option value={4.7}>4.7+</option>
            <option value={4.8}>4.8+</option>
            <option value={4.9}>4.9</option>
          </select>
        </label>
      </div>
      <p className="muted">{filtered.length} {dict.results}</p>
      {filtered.length === 0 ? (
        <p className="empty-note">{dict.no_results}</p>
      ) : (
        <div className="grid">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} dict={dict} currency={currency} />
          ))}
        </div>
      )}
    </div>
  );
}
