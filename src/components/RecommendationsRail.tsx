"use client";
/**
 * Recommendations rail (Phase 3, feature 5). Fetches ranked, reason-coded
 * recommendations from /api/recommendations; hides itself entirely when
 * the feature flag is off (403) or nothing is recommended. View history
 * stays on-device: slugs from localStorage are sent as ids only — the
 * aggregator never receives identity data.
 *
 * The rail renders ONLY the product objects carried in the API payload
 * (register item 82 fix): it holds no local product list, so nothing
 * the server did not send can ever be displayed here.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import type { Product } from "../data/products";
import ProductCard from "./ProductCard";

interface RecoItem {
  id: string;
  reason: "also_bought" | "similar_category" | "top_rated";
  product: Product;
}

export default function RecommendationsRail({
  locale,
  dict,
  currency,
  productId,
  excludeIds = [],
}: {
  locale: string;
  dict: Dict;
  currency: string;
  productId?: string;
  excludeIds?: string[];
}) {
  const [items, setItems] = useState<RecoItem[]>([]);
  useEffect(() => {
    let viewed: string[] = [];
    try {
      viewed = JSON.parse(localStorage.getItem("astralium-viewed") ?? "[]") as string[];
    } catch { viewed = []; }
    const qs = new URLSearchParams();
    if (productId) qs.set("productId", productId);
    if (viewed.length > 0) qs.set("viewed", viewed.join(","));
    if (excludeIds.length > 0) qs.set("exclude", excludeIds.join(","));
    void (async () => {
      try {
        const res = await fetch(`/api/recommendations?${qs.toString()}`);
        if (!res.ok) return; // flag off / error → rail stays hidden
        const data = (await res.json()) as { recommendations: RecoItem[] };
        // Payload-only rendering: an item without its server-sent
        // product object is dropped, never resolved locally.
        setItems((data.recommendations ?? []).filter((i) => i && i.product && i.product.id === i.id));
      } catch { /* hidden */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  if (items.length === 0) return null;
  const reasonLabel = (r: RecoItem["reason"]) =>
    r === "also_bought" ? dict.reco_also_bought : r === "similar_category" ? dict.reco_similar : dict.reco_top_rated;
  return (
    <section className="section">
      <h2>{dict.reco_t}</h2>
      <div className="grid">
        {items.map((item) => (
          <div key={item.id}>
            <ProductCard product={item.product} locale={locale} dict={dict} currency={currency} />
            <p className="muted" style={{ marginTop: 6 }}>{reasonLabel(item.reason)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
