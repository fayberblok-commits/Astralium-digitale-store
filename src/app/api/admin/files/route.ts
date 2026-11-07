import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/team";
import { listAdminProducts } from "../../../../lib/catalog";
import { getBinding } from "../../../../lib/bindings";
import { isStorageConfigured } from "../../../../services/storage";
import { isDbConfigured } from "../../../../lib/db";

export const runtime = "nodejs";

/** Current file binding + configuration status for one product. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const productId = req.nextUrl.searchParams.get("productId");
  // Resolve through the real catalog (DB source of truth, incl. inactive
  // products) — the seed list alone misses office-created products.
  const { products } = productId ? await listAdminProducts() : { products: [] };
  if (!productId || !products.some((p) => p.id === productId)) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  const binding = await getBinding(productId);
  return NextResponse.json({
    productId,
    binding,
    storageConfigured: isStorageConfigured(),
    dbConfigured: isDbConfigured(),
  });
}
