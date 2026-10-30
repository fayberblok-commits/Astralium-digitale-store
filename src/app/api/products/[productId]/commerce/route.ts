import { NextRequest, NextResponse } from "next/server";
import { getProductById } from "../../../../../data/products";
import { getFlag } from "../../../../../lib/flags";
import { activeSaleForProduct, flashUnitPrice, listFlashSales } from "../../../../../lib/flash-sales";
import { getPwywConfig } from "../../../../../lib/pwyw";
import { getPreorderConfig, isReleased, releaseDateFor } from "../../../../../lib/preorders";
import { getPlanConfig } from "../../../../../lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-product Phase 4 commerce state for the product page. Every block
 * appears ONLY when its feature flag is on and the product is
 * configured; prices are computed here server-side. The flash block
 * carries the campaign's server-stored end timestamp (countdown target).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = getProductById(productId);
  if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  const now = new Date();
  const out: {
    flash: { name: string; discountPercent: number; fullPriceUSD: number; priceUSD: number; endsAt: string; remaining: number | null } | null;
    pwyw: { minUSD: number; suggestedUSD: number; tiers: { priceUSD: number; label: string; bonus: string }[] } | null;
    preorder: { releaseDate: string; released: boolean } | null;
    plan: { interval: "month" | "year"; priceUSD: number } | null;
  } = { flash: null, pwyw: null, preorder: null, plan: null };

  if (await getFlag("flash_sales")) {
    const sale = activeSaleForProduct(await listFlashSales(), product.id, now);
    if (sale) {
      out.flash = {
        name: sale.name,
        discountPercent: sale.discountPercent,
        fullPriceUSD: product.priceUSD,
        priceUSD: flashUnitPrice(sale, product),
        endsAt: sale.endsAt,
        remaining: sale.quantityCap === null ? null : Math.max(0, sale.quantityCap - sale.soldCount),
      };
    }
  }
  if (await getFlag("pwyw")) {
    const config = await getPwywConfig();
    if (config[product.id]) out.pwyw = config[product.id];
  }
  if (await getFlag("preorders")) {
    const config = await getPreorderConfig();
    const release = releaseDateFor(config, product.id);
    if (release) {
      out.preorder = { releaseDate: release.toISOString(), released: isReleased(config, product.id, now) };
    }
  }
  if (await getFlag("subscriptions")) {
    const plans = await getPlanConfig();
    if (plans[product.id]) out.plan = plans[product.id];
  }
  return NextResponse.json(out);
}
