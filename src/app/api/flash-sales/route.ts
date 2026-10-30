import { NextResponse } from "next/server";
import { getProductById } from "../../../data/products";
import { getFlag } from "../../../lib/flags";
import { campaignState, flashUnitPrice, listFlashSales } from "../../../lib/flash-sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public flash-sale feed (Phase 4, feature 9). Returns ACTIVE campaigns
 * with their server-side end timestamp (the countdown target), the
 * discounted prices (computed here, never client-side) and remaining
 * cap. Flag-gated: 403 while flash_sales is off.
 */
export async function GET() {
  if (!(await getFlag("flash_sales"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const now = new Date();
  const sales = await listFlashSales();
  const active = sales
    .filter((s) => campaignState(s, now) === "active")
    .map((s) => ({
      id: s.id,
      name: s.name,
      discountPercent: s.discountPercent,
      startsAt: s.startsAt,
      endsAt: s.endsAt, // server-provided countdown target
      remaining: s.quantityCap === null ? null : Math.max(0, s.quantityCap - s.soldCount),
      items: s.productIds
        .map((pid) => getProductById(pid))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({ productId: p.id, slug: p.slug, title: p.title, fullPriceUSD: p.priceUSD, priceUSD: flashUnitPrice(s, p) })),
    }));
  return NextResponse.json({ serverNow: now.toISOString(), sales: active });
}
