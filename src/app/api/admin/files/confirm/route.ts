import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import { getProductById } from "../../../../../data/products";
import { deleteObject, getObjectHeadBytes, headObject, isStorageConfigured } from "../../../../../services/storage";
import { SNIFF_BYTES, verifyFileMagic } from "../../../../../lib/file-sniff";
import { recordSecurityEvent } from "../../../../../lib/security-log";
import { setBinding } from "../../../../../lib/bindings";
import { isDbConfigured } from "../../../../../lib/db";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Step 3 of the admin upload flow (after the browser PUT): verify the
 * object really exists in S3, then persist the product → fileKey binding
 * (DB Product row when configured, else the local .data JSON store).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "files");
  if ("error" in auth) return auth.error;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }
  let body: {
    productId?: string;
    fileKey?: string;
    kind?: string;
    version?: string;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
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
  // §9 size enforcement on the REAL object (declared size at presign
  // time is a claim; the HEAD length is the fact).
  if (head.contentLength !== undefined && head.contentLength > 5 * 1024 * 1024 * 1024) {
    await deleteObject(body.fileKey);
    return NextResponse.json({ error: "FILE_TOO_LARGE", maxBytes: 5 * 1024 * 1024 * 1024 }, { status: 413 });
  }
  // §9: magic-byte verification — the object's BYTES must match the
  // format its filename claims. A mismatch destroys the object and the
  // binding is refused: a renamed executable can never become a
  // deliverable. (Preview images are checked the same way.)
  const extension = body.fileKey.split(".").pop() ?? "";
  const headBytes = await getObjectHeadBytes(body.fileKey, SNIFF_BYTES);
  if (headBytes) {
    const verdict = verifyFileMagic(extension, headBytes);
    if (!verdict.ok) {
      await deleteObject(body.fileKey);
      await recordSecurityEvent({
        kind: "upload_magic_rejected",
        actor: auth.actor.actor,
        detail: { productId: product.id, reason: verdict.reason },
      });
      return NextResponse.json({ error: "FILE_CONTENT_MISMATCH", reason: verdict.reason }, { status: 422 });
    }
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
