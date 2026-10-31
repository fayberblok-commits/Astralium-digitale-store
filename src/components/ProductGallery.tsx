"use client";
/**
 * Product gallery (Phase 3 upgrade).
 *
 * The store's covers are generated art (lib Cover), so the gallery
 * presents the cover in its three duotone treatments as switchable
 * views, with a thumbnail rail. Every view is the same fixed-aspect
 * .cover box, so switching can never shift layout (CLS-safe), and the
 * thumbnails are real buttons — fully usable by touch and keyboard.
 */
import { useState } from "react";
import type { Product } from "../data/products";
import Cover from "./Cover";

export default function ProductGallery({
  product,
  galleryLabel,
}: {
  product: Product;
  galleryLabel: string;
}) {
  // Three deterministic treatments of the same cover art.
  const views = [product.hue, product.hue + 3, product.hue + 6];
  const [active, setActive] = useState(0);
  return (
    <div className="gallery">
      <div className="gallery-main">
        <Cover title={product.title} category={product.category} hue={views[active]} size="lg" />
      </div>
      <div className="gallery-thumbs" role="group" aria-label={galleryLabel}>
        {views.map((hue, i) => (
          <button
            key={i}
            type="button"
            className={`gallery-thumb ${i === active ? "thumb-on" : ""}`}
            aria-label={`${galleryLabel} ${i + 1}`}
            aria-pressed={i === active}
            onClick={() => setActive(i)}
          >
            <Cover title={product.title} category={product.category} hue={hue} size="sm" />
          </button>
        ))}
      </div>
    </div>
  );
}
