import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/server";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Phase 1 upgrade (§6): the admin path is deliberately NOT named
        // here — listing it in robots.txt advertised it. Admin pages
        // carry noindex metadata + X-Robots-Tag and are protected by
        // authentication, not obscurity.
        disallow: ["/api/", "/*/checkout", "/*/cart", "/*/success"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
