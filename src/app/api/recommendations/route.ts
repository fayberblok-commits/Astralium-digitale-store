import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { getDb } from "../../../lib/db";
import { scoreRecommendations, basketsFromOrders } from "../../../lib/recommendations";
import { getProductById } from "../../../data/products";

export const runtime = "nodejs";

/**
 * Recommendations API (Phase 3, feature 5). Co-purchase baskets are read
 * from DB orders as product-id lists ONLY — the aggregator never sees an
 * email (see src/lib/recommendations.ts). Without a DB, baskets are
 * empty and the engine serves its catalog-affinity fallback.
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
  const recs = scoreRecommendations({ baskets, targetId: productId, viewedIds: viewed, excludeIds: exclude, limit: 4 });
  return NextResponse.json({
    source: baskets.length > 0 ? "co-purchase" : "catalog-affinity",
    recommendations: recs
      .map((r) => {
        const p = getProductById(r.productId);
        return p ? { id: p.id, slug: p.slug, title: p.title, reason: r.reason, coCount: r.coCount ?? null } : null;
      })
      .filter(Boolean),
  });
}
