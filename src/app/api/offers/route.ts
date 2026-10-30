import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { getOfferConfig } from "../../../lib/offers";
import { getProductById } from "../../../data/products";

export const runtime = "nodejs";

/**
 * Public offer lookup for checkout + success pages (Phase 3, feature 4).
 * Flag-gated: when order_bump is off this 403s and the UI hides itself.
 * Returns only product ids + percents from the server config.
 */
export async function GET(req: NextRequest) {
  if (!(await getFlag("order_bump"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const config = await getOfferConfig();
  const productId = req.nextUrl.searchParams.get("productId");
  const describe = (slot?: { productId: string; discountPercent: number }) => {
    if (!slot) return undefined;
    const p = getProductById(slot.productId);
    return p ? { productId: p.id, slug: p.slug, title: p.title, priceUSD: p.priceUSD, discountPercent: slot.discountPercent } : undefined;
  };
  if (productId) {
    const offer = config[productId];
    return NextResponse.json({ productId, bump: describe(offer?.bump), upsell: describe(offer?.upsell) });
  }
  const out: Record<string, { bump?: unknown; upsell?: unknown }> = {};
  for (const [pid, offer] of Object.entries(config)) {
    out[pid] = { bump: describe(offer.bump), upsell: describe(offer.upsell) };
  }
  return NextResponse.json({ offers: out });
}
