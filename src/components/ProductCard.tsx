import Link from "next/link";
import type { Product } from "../data/products";
import type { Dict } from "../i18n/dictionaries";
import { formatPrice, formatProductPrice } from "../lib/currency";
import { discountPercent } from "../lib/catalog-view";
import Cover from "./Cover";
import Tilt from "./Tilt";
import QuickView from "./QuickView";
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
  const discount = discountPercent(product);
  return (
    <article className="card">
      <div className="card-cover-wrap">
        <Tilt>
          <Link href={`/${locale}/product/${product.slug}`} className="card-cover-link" aria-label={product.title}>
            <Cover title={product.title} category={product.category} hue={product.hue} />
          </Link>
        </Tilt>
        {product.badge && (
          <span className={`badge badge-${product.badge}`}>
            {product.badge === "bestseller" ? dict.badge_bestseller : dict.badge_new}
          </span>
        )}
        {discount > 0 && (
          <span className="badge badge-discount">{dict.discount_off.replace("{n}", String(discount))}</span>
        )}
        <span className="card-wish">
          <WishButton slug={product.slug} label={dict.wishlist_t} />
        </span>
      </div>
      <div className="card-body">
        <div className="card-meta">
          <span>{dict[`cat_${product.category}`] ?? product.category}</span>
        </div>
        <Link href={`/${locale}/product/${product.slug}`} className="card-title">
          {product.title}
        </Link>
        <p className="card-sub">{product.subtitle}</p>
        <p className="card-rating">
          <Stars rating={product.rating} /> {product.rating} · {product.reviewsCount} {dict.reviews}
        </p>
        <p className="card-price">
          <strong>{formatProductPrice(product, currency, locale)}</strong>
          {product.compareAtUSD && (
            <s>{formatPrice(product.compareAtUSD, currency, locale)}</s>
          )}
        </p>
        <div className="card-actions">
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
          <QuickView
            product={product}
            locale={locale}
            currency={currency}
            labels={{
              quickView: dict.quick_view,
              close: dict.quick_close,
              viewProduct: dict.view_product,
              addToCart: dict.add_to_cart,
              inCart: dict.in_cart,
              buyNow: dict.buy_now,
              includes: dict.includes_t,
              reviews: dict.reviews,
              category: dict[`cat_${product.category}`] ?? product.category,
            }}
          />
        </div>
      </div>
    </article>
  );
}
