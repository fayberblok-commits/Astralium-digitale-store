/**
 * SEO engine (Phase 5, feature 22). Flag `seo_engine` — default ON.
 *
 *  - Dynamic sitemap: every locale × static pages + products + legal
 *    docs + PUBLISHED blog posts (drafts never leak into the sitemap).
 *    buildSitemapEntries is a pure function so the coverage is pinned
 *    by unit tests; src/app/sitemap.ts is a thin wrapper over it.
 *  - robots.txt: already derived from the env base URL (siteUrl()) —
 *    kept, with the host directive added.
 *  - Open Graph: layout-level defaults plus a per-product OG image via
 *    next/og ImageResponse (brand-styled: ivory, ink, antique gold —
 *    the luxury-classic identity), wired through the opengraph-image
 *    file convention.
 *  - JSON-LD: Product + Offer always (price/availability are real
 *    catalog data); AggregateRating ONLY from real approved reviews
 *    (Phase 3 store) — when no approved review exists the block is
 *    omitted rather than filled from illustrative seed data;
 *    BreadcrumbList reflects the real page path.
 */
import type { Product } from "../data/products.ts";
import type { BlogPostRecord } from "./blog.ts";

export interface SitemapEntry {
  url: string;
  lastModified?: string;
}

/** Static per-locale paths covered by the sitemap ("" = locale home). */
export const SITEMAP_STATIC_PATHS = ["", "/shop", "/account"];

export function buildSitemapEntries(input: {
  base: string;
  locales: string[];
  products: { slug: string; publishedAt: string }[];
  legalSlugs: string[];
  blogPosts: Pick<BlogPostRecord, "slug" | "locale" | "updatedAt">[];
  /** Include the /blog index per locale (only when the blog flag is on,
   * so the sitemap never advertises a 404). */
  includeBlog?: boolean;
}): SitemapEntry[] {
  const base = input.base.replace(/\/$/, "");
  const entries: SitemapEntry[] = [];
  const staticPaths = input.includeBlog ? [...SITEMAP_STATIC_PATHS, "/blog"] : SITEMAP_STATIC_PATHS;
  for (const locale of input.locales) {
    for (const p of staticPaths) entries.push({ url: `${base}/${locale}${p}` });
    for (const product of input.products) {
      entries.push({ url: `${base}/${locale}/product/${product.slug}`, lastModified: product.publishedAt });
    }
    for (const slug of input.legalSlugs) entries.push({ url: `${base}/${locale}/legal/${slug}` });
    for (const post of input.blogPosts) {
      if (post.locale !== locale) continue;
      entries.push({ url: `${base}/${locale}/blog/${post.slug}`, lastModified: post.updatedAt });
    }
  }
  return entries;
}

/** Product JSON-LD. reviewAgg is included ONLY when real and non-zero. */
export function buildProductJsonLd(input: {
  product: Product;
  locale: string;
  siteBase: string;
  reviewAgg?: { count: number; average: number } | null;
}): Record<string, unknown> {
  const { product, locale, siteBase } = input;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    url: `${siteBase}/${locale}/product/${product.slug}`,
    category: product.category,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: product.priceUSD.toFixed(2),
      availability: "https://schema.org/InStock",
      url: `${siteBase}/${locale}/product/${product.slug}`,
    },
  };
  if (input.reviewAgg && input.reviewAgg.count > 0) {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: input.reviewAgg.average,
      reviewCount: input.reviewAgg.count,
    };
  }
  return ld;
}

export function buildBreadcrumbJsonLd(input: {
  siteBase: string;
  locale: string;
  trail: { name: string; path: string }[];
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: input.trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${input.siteBase}/${input.locale}${item.path}`,
    })),
  };
}
