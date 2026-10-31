import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { searchProducts, suggestProducts, type SearchFilters } from "../../../lib/search";
import { searchProductsDb } from "../../../lib/search-db";
// Phase 1 upgrade (F2): search runs over the resolved storefront
// catalog (DB-first) — never the static file alone when a DB is live.
import { getStorefrontProducts } from "../../../lib/catalog";

export const runtime = "nodejs";

/**
 * Smart search API (Phase 3, feature 6). Tries the pg_trgm database
 * ranking first (when a DB is configured + synced); any miss falls back
 * to the always-available in-memory fuzzy search. Filters: category,
 * format, maxPrice, minRating, language. `suggest=1` returns title-led
 * suggestions for the catalog dropdown.
 */
export async function GET(req: NextRequest) {
  if (!(await getFlag("smart_search"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").slice(0, 120);
  const filters: SearchFilters = {
    category: sp.get("category") ?? undefined,
    format: sp.get("format") ?? undefined,
    language: sp.get("language") ?? undefined,
    maxPriceUSD: sp.get("maxPrice") ? Number(sp.get("maxPrice")) : undefined,
    minRating: sp.get("minRating") ? Number(sp.get("minRating")) : undefined,
  };
  const pool = await getStorefrontProducts();
  if (sp.get("suggest") === "1") {
    const items = suggestProducts(q, 6, pool).map((p) => ({ id: p.id, slug: p.slug, title: p.title, category: p.category }));
    return NextResponse.json({ suggestions: items });
  }
  // DB trigram path first for non-empty queries without in-memory-only filters.
  if (q.trim()) {
    const dbHits = await searchProductsDb(q, 48, pool);
    if (dbHits) {
      const { passesFilters } = await import("../../../lib/search");
      const filtered = dbHits.filter((p) => passesFilters(p, filters));
      return NextResponse.json({
        source: "db-trigram",
        results: filtered.map((p) => ({ id: p.id, slug: p.slug, title: p.title, score: null })),
      });
    }
  }
  const hits = searchProducts(q, { filters, catalog: pool });
  return NextResponse.json({
    source: "memory-fuzzy",
    results: hits.map((h) => ({ id: h.product.id, slug: h.product.slug, title: h.product.title, score: h.score })),
  });
}
