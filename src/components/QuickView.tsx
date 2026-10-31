"use client";
/**
 * Quick View (Phase 3 upgrade): a modal sheet with the essentials of a
 * product — cover, rating, price, what-you-get, formats — plus the
 * real buy actions, without leaving the listing. Opens from the card;
 * closes on backdrop click, the ✕ button or Escape; body scroll is
 * locked while open. All strings arrive via the dictionary subset
 * passed from the (server) card.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Product } from "../data/products";
import { formatPrice, formatProductPrice } from "../lib/currency";
import Cover from "./Cover";
import { AddToCartButton } from "./Buttons";

export interface QuickViewLabels {
  quickView: string;
  close: string;
  viewProduct: string;
  addToCart: string;
  inCart: string;
  buyNow: string;
  includes: string;
  reviews: string;
  category: string;
}

export default function QuickView({
  product,
  locale,
  currency,
  labels,
}: {
  product: Product;
  locale: string;
  currency: string;
  labels: QuickViewLabels;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  return (
    <>
      <button type="button" className="btn btn-ghost card-quick-btn" onClick={() => setOpen(true)}>
        {labels.quickView}
      </button>
      {open && (
        <div className="qv-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="qv-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={product.title}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              ref={closeRef}
              className="icon-btn qv-close"
              aria-label={labels.close}
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
            <div className="qv-grid">
              <Cover title={product.title} category={product.category} hue={product.hue} size="lg" />
              <div className="qv-body">
                <p className="muted" style={{ textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>
                  {labels.category}
                </p>
                <h3 style={{ margin: "4px 0" }}>{product.title}</h3>
                <p className="muted" style={{ margin: 0 }}>{product.subtitle}</p>
                <p style={{ margin: "6px 0" }}>
                  <span className="stars" aria-hidden="true">{"★".repeat(Math.round(product.rating))}</span>{" "}
                  {product.rating} · {product.reviewsCount} {labels.reviews}
                </p>
                <p className="card-price">
                  <strong>{formatProductPrice(product, currency, locale)}</strong>
                  {product.compareAtUSD && <s>{formatPrice(product.compareAtUSD, currency, locale)}</s>}
                </p>
                <p style={{ fontWeight: 700, margin: "10px 0 4px" }}>{labels.includes}</p>
                <ul className="includes" style={{ margin: 0 }}>
                  {product.includes.slice(0, 4).map((inc) => (
                    <li key={inc}>{inc}</li>
                  ))}
                </ul>
                <p className="muted" style={{ margin: "8px 0" }}>
                  {product.formats.map((f) => f.format).join(" · ")}
                </p>
                <div className="btn-row">
                  <AddToCartButton
                    item={{
                      id: product.id, kind: "product", slug: product.slug,
                      title: product.title, priceUSD: product.priceUSD, hue: product.hue,
                    }}
                    locale={locale}
                    addLabel={labels.addToCart}
                    inCartLabel={labels.inCart}
                    buyLabel={labels.buyNow}
                  />
                  <Link href={`/${locale}/product/${product.slug}`} className="btn btn-ghost">
                    {labels.viewProduct}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
