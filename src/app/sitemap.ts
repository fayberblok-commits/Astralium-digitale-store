import type { MetadataRoute } from "next";
import { LOCALE_CODES } from "../i18n/locales";
import { PRODUCTS } from "../data/products";
import { LEGAL_DOCS } from "../data/legal";
import { siteUrl } from "../lib/server";
import { getFlag } from "../lib/flags";
import { listBlogPosts } from "../lib/blog";
import { buildSitemapEntries } from "../lib/seo";

// Blog posts are runtime content: the sitemap must be generated per
// request, never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Dynamic sitemap (Phase 5, SEO engine). With `seo_engine` on: every
 * locale × (home, shop, account, blog) + products + legal docs +
 * PUBLISHED blog posts in their own locale. With it off: the pre-Phase-5
 * coverage (no blog surface). Drafts never appear in either mode.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const seoOn = await getFlag("seo_engine");
  const blogOn = seoOn && (await getFlag("blog"));
  const posts = blogOn ? await listBlogPosts({ status: "published" }) : [];

  if (!seoOn) {
    // Legacy coverage, preserved verbatim for flag-off deployments.
    const entries: MetadataRoute.Sitemap = [];
    const languages = Object.fromEntries(LOCALE_CODES.map((l) => [l, ""]));
    for (const locale of LOCALE_CODES) {
      const langAlternates = { ...languages };
      for (const l of LOCALE_CODES) langAlternates[l] = `${base}/${l}`;
      entries.push({ url: `${base}/${locale}`, alternates: { languages: langAlternates } });
      entries.push({ url: `${base}/${locale}/shop` });
      entries.push({ url: `${base}/${locale}/account` });
      for (const p of PRODUCTS) {
        entries.push({ url: `${base}/${locale}/product/${p.slug}`, lastModified: new Date(p.publishedAt) });
      }
      for (const d of LEGAL_DOCS) entries.push({ url: `${base}/${locale}/legal/${d.slug}` });
    }
    return entries;
  }

  const built = buildSitemapEntries({
    base,
    locales: LOCALE_CODES,
    products: PRODUCTS.map((p) => ({ slug: p.slug, publishedAt: p.publishedAt })),
    legalSlugs: LEGAL_DOCS.map((d) => d.slug),
    blogPosts: posts,
    includeBlog: blogOn,
  });
  return built.map((entry) => {
    const isHome = LOCALE_CODES.some((l) => entry.url === `${base}/${l}`);
    return {
      url: entry.url,
      ...(entry.lastModified ? { lastModified: new Date(entry.lastModified) } : {}),
      ...(isHome
        ? { alternates: { languages: Object.fromEntries(LOCALE_CODES.map((l) => [l, `${base}/${l}`])) } }
        : {}),
    };
  });
}
