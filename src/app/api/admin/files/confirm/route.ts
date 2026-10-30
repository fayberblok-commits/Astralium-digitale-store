import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "../../../../../lib/admin";
import { getProductById } from "../../../../../data/products";
import { headObject, isStorageConfigured } from "../../../../../services/storage";
import { setBinding } from "../../../../../lib/bindings";
import { isDbConfigured } from "../../../../../lib/db";

export const runtime = "nodejs";

/**
 * Step 3 of the admin upload flow (after the browser PUT): verify the
 * object really exists in S3, then persist the product → fileKey binding
 * (DB Product row when configured, else the local .data JSON store).
 */
export async function POST(req: NextRequest) {
  if (!isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as {
    productId?: string;
    fileKey?: string;
    kind?: string;
    version?: string;
  } | null;
  if (!body?.productId || !body?.fileKey || (body.kind !== "product" && body.kind !== "preview")) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const product = getProductById(body.productId);
  if (!product) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  // The key must live under this product's namespace — never bind arbitrary keys.
  const expectedPrefix = body.kind === "preview" ? `previews/${product.id}/` : `products/${product.id}/`;
  if (!body.fileKey.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "KEY_OUTSIDE_PRODUCT_NAMESPACE" }, { status: 400 });
  }
  const head = await headObject(body.fileKey);
  if (!head.exists) {
    return NextResponse.json({ error: "OBJECT_NOT_FOUND_IN_STORAGE" }, { status: 422 });
  }
  // When a DB is configured the product row must exist (run the catalog sync first).
  if (isDbConfigured()) {
    const { getDb } = await import("../../../../../lib/db");
    const db = await getDb();
    if (db) {
      const row = await db.product.findUnique({ where: { id: product.id } });
      if (!row) {
        return NextResponse.json(
          { error: "PRODUCT_NOT_IN_DB", hint: "Run: npm run sync-catalog" },
          { status: 409 },
        );
      }
    }
  }
  const { persisted, binding } = await setBinding(product.id, {
    ...(body.kind === "preview" ? { previewKey: body.fileKey } : { fileKey: body.fileKey }),
    ...(body.kind === "product" && body.version ? { version: body.version } : {}),
  });
  return NextResponse.json({
    ok: true,
    persisted,
    binding,
    object: { contentLength: head.contentLength, contentType: head.contentType },
  });
}
