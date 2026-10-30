import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/server";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/*/control-astralium", "/*/checkout", "/*/cart", "/*/success"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
