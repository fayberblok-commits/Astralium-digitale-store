"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWishlist } from "@/components/wishlist-button";
import { categoryLabel, type LocaleCode } from "@/lib/i18n";
import { convertFromUsd, formatAmount } from "@/lib/money";

type Item = {
  slug: string;
  title: string;
  titleEn: string | null;
  subtitle: string | null;
  subtitleEn: string | null;
  category: string;
  priceCents: number;
  coverStyle: string;
  coverGlyph: string;
};

export function WishlistView({
  locale,
  currency,
  labels,
}: {
  locale: LocaleCode;
  currency: string;
  labels: { details: string; remove: string; empty: string };
}) {
  const { items, toggle } = useWishlist();
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (items.length === 0) {
        setCatalog([]);
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/products?slugs=${encodeURIComponent(items.join(","))}`);
        const data = (await response.json()) as { products?: Item[] };
        if (!cancelled) setCatalog(data.products ?? []);
      } catch {
        if (!cancelled) setCatalog([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (loading) {
    return <div className="glass rounded-2xl p-8 text-center text-sm text-[#a8a4b8]">{locale === "ar" ? "جارٍ تحميل قائمتك…" : "Loading your list…"}</div>;
  }

  if (items.length === 0) {
    return (
      <div className="glass rounded-2xl px-6 py-12 text-center">
        <p className="text-2xl" aria-hidden="true">
          ☆
        </p>
        <p className="mt-2 font-display text-xl text-[#f4efe3]">{labels.empty}</p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[#a8a4b8]">
          {locale === "ar" ? "اضغط علامة النجمة على أي منتج لإضافته إلى قائمتك." : "Press the star on any product to save it here."}
        </p>
        <Link href="/catalog" className="btn-gold mt-5">
          {locale === "ar" ? "استعرض المكتبة" : "Browse the library"}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {catalog.map((item) => (
        <article key={item.slug} className="glass rounded-2xl p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="chip">{categoryLabel(item.category, locale)}</span>
            <button
              type="button"
              onClick={() => toggle(item.slug)}
              className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-[#cfc9d8] hover:border-rose-300/50 hover:text-rose-200"
            >
              {labels.remove}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] text-xl" aria-hidden="true">
              {item.coverGlyph}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[#f4efe3]">{locale === "ar" ? item.title : item.titleEn || item.title}</h2>
              <p className="line-clamp-1 text-[12px] text-[#a8a4b8]">{locale === "ar" ? item.subtitle : item.subtitleEn || item.subtitle}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="tabular text-[#f0dcae]">{formatAmount(convertFromUsd(item.priceCents, currency), currency, locale)}</span>
            <Link href={`/product/${item.slug}`} className="btn-ghost px-3 py-1.5 text-[11.5px]">
              {labels.details}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
