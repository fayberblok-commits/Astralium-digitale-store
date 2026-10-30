import Link from "next/link";
import type { Product } from "../data/products";
import type { Dict } from "../i18n/dictionaries";
import { formatPrice } from "../lib/currency";
import Cover from "./Cover";
import { AddToCartButton, WishButton } from "./Buttons";

export function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="stars" aria-label={`${rating} / 5`}>
      {"★★★★★".slice(0, full)}
      <span className="stars-dim">{"★★★★★".slice(full)}</span>
    </span>
  );
}

export default function ProductCard({
  product,
  locale,
  dict,
  currency,
}: {
  product: Product;
  locale: string;
  dict: Dict;
  currency: string;
}) {
  return (
    <article className="card">
      <Link href={`/${locale}/product/${product.slug}`} className="card-cover-link" aria-label={product.title}>
        <Cover title={product.title} category={product.category} hue={product.hue} />
      </Link>
      {product.badge && (
        <span className={`badge badge-${product.badge}`}>
          {product.badge === "bestseller" ? dict.badge_bestseller : dict.badge_new}
        </span>
      )}
      <div className="card-body">
        <div className="card-meta">
          <span>{dict[`cat_${product.category}`] ?? product.category}</span>
          <WishButton slug={product.slug} label={dict.wishlist_t} />
        </div>
        <Link href={`/${locale}/product/${product.slug}`} className="card-title">
          {product.title}
        </Link>
        <p className="card-sub">{product.subtitle}</p>
        <p className="card-rating">
          <Stars rating={product.rating} /> {product.rating} · {product.reviewsCount} {dict.reviews}
        </p>
        <p className="card-price">
          <strong>{formatPrice(product.priceUSD, currency, locale)}</strong>
          {product.compareAtUSD && (
            <s>{formatPrice(product.compareAtUSD, currency, locale)}</s>
          )}
        </p>
        <AddToCartButton
          locale={locale}
          addLabel={dict.add_to_cart}
          inCartLabel={dict.in_cart}
          item={{
            id: product.id,
            kind: "product",
            slug: product.slug,
            title: product.title,
            priceUSD: product.priceUSD,
            hue: product.hue,
          }}
        />
      </div>
    </article>
  );
}
