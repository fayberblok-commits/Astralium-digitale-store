import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/team";
import { getProductById } from "../../../../data/products";
import { getBinding } from "../../../../lib/bindings";
import { isStorageConfigured } from "../../../../services/storage";
import { isDbConfigured } from "../../../../lib/db";

export const runtime = "nodejs";

/** Current file binding + configuration status for one product. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId || !getProductById(productId)) {
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
