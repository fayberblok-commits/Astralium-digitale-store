import type { MetadataRoute } from "next";
import { LOCALE_CODES } from "../i18n/locales";
import { PRODUCTS, BUNDLES } from "../data/products";
import { LEGAL_DOCS } from "../data/legal";
import { siteUrl } from "../lib/server";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
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
  void BUNDLES;
  return entries;
}
