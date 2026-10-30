import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "../../../../lib/admin";
import { getProductById } from "../../../../data/products";
import { getBinding } from "../../../../lib/bindings";
import { isStorageConfigured } from "../../../../services/storage";
import { isDbConfigured } from "../../../../lib/db";

export const runtime = "nodejs";

/** Current file binding + configuration status for one product. */
export async function GET(req: NextRequest) {
  if (!isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }
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
