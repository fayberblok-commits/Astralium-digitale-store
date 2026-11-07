/**
 * Promo trio (owner order 2026-11-07): three designed promotional
 * cards for the book — cover showcase, a real look-inside page, and a
 * by-the-numbers card of verified facts — shown as a dedicated,
 * prominent set high on the product page, right under the buy panel.
 * Server component: pure markup, images ship as data-URI assets
 * (assets/promos.ts). Products without a trio render nothing.
 */
import { promoImagesFor } from "../assets/promos";
import type { Dict } from "../i18n/dictionaries";

export default function PromoTrio({
  productId,
  title,
  dict,
}: {
  productId: string;
  title: string;
  dict: Dict;
}) {
  const images = promoImagesFor(productId);
  if (!images) return null;
  const captions = [dict.promo_c1, dict.promo_c2, dict.promo_c3];
  return (
    <section className="section promo-trio-section">
      <h2>{dict.promo_t}</h2>
      <div className="promo-trio">
        {images.map((src, i) => (
          <figure className="promo-card led-cover" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${title} — ${captions[i]}`}
              width={880}
              height={1100}
              loading="lazy"
            />
            <figcaption>{captions[i]}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
