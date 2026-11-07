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
  // View 0 is the product's real printed cover (Cover resolves it by
  // id for the five books; other products fall back to the duotone).
  // Views 1–2 keep the deterministic duotone treatments.
  const views: { hue: number; real?: boolean }[] = [
    { hue: product.hue, real: true },
    { hue: product.hue + 3 },
    { hue: product.hue + 6 },
  ];
  const [active, setActive] = useState(0);
  return (
    <div className="gallery">
      <div className="gallery-main">
        <Cover
          title={product.title}
          category={product.category}
          hue={views[active].hue}
          size="lg"
          id={views[active].real ? product.id : undefined}
        />
      </div>
      <div className="gallery-thumbs" role="group" aria-label={galleryLabel}>
        {views.map((view, i) => (
          <button
            key={i}
            type="button"
            className={`gallery-thumb ${i === active ? "thumb-on" : ""}`}
            aria-label={`${galleryLabel} ${i + 1}`}
            aria-pressed={i === active}
            onClick={() => setActive(i)}
          >
            <Cover
              title={product.title}
              category={product.category}
              hue={view.hue}
              size="sm"
              id={view.real ? product.id : undefined}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
