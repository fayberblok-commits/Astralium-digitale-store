import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { getDb } from "../../../lib/db";
import { scoreRecommendations, basketsFromOrders } from "../../../lib/recommendations";
import { getStorefrontProducts } from "../../../lib/catalog";

export const runtime = "nodejs";

/**
 * Recommendations API (Phase 3, feature 5). Co-purchase baskets are read
 * from DB orders as product-id lists ONLY — the aggregator never sees an
 * email (see src/lib/recommendations.ts). Without a DB, baskets are
 * empty and the engine serves its catalog-affinity fallback.
 *
 * Catalog discipline (register item 82 fix): scoring runs over the LIVE
 * storefront catalog only, and every recommendation carries its full
 * storefront product in the payload — the client renders exactly what
 * the server sends and never resolves ids against any local list, so a
 * deactivated/demo product can never appear in the rail again.
 */
export async function GET(req: NextRequest) {
  if (!(await getFlag("recommendations"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const productId = sp.get("productId") ?? undefined;
  const viewed = (sp.get("viewed") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const exclude = (sp.get("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);

  let baskets: string[][] = [];
  try {
    const db = await getDb();
    if (db) {
      const orders = await db.order.findMany({
        where: { status: { in: ["paid", "fulfilled"] } },
        include: { items: { select: { productId: true } } },
        take: 500,
      });
      baskets = basketsFromOrders(orders);
    }
  } catch {
    baskets = [];
  }
  const catalog = await getStorefrontProducts();
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const recs = scoreRecommendations({ baskets, targetId: productId, viewedIds: viewed, excludeIds: exclude, catalog, limit: 4 });
  return NextResponse.json({
    source: baskets.length > 0 ? "co-purchase" : "catalog-affinity",
    recommendations: recs
      .map((r) => {
        const p = byId.get(r.productId);
        return p ? { id: p.id, slug: p.slug, title: p.title, reason: r.reason, coCount: r.coCount ?? null, product: p } : null;
      })
      .filter(Boolean),
  });
}
