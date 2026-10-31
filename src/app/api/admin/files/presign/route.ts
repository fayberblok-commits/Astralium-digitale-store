import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import { getProductById } from "../../../../../data/products";
import { ALLOWED_EXTENSIONS, MAX_DECLARED_BYTES, sanitizeFilename } from "../../../../../lib/uploads";
import {
  isStorageConfigured,
  presignPut,
  productFileKey,
  previewFileKey,
} from "../../../../../services/storage";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Step 1 of the admin upload flow: mint a presigned PUT URL so the browser
 * uploads the file directly to S3. Nothing touches this server but JSON.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "files");
  if ("error" in auth) return auth.error;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }
  let body: {
    productId?: string;
    filename?: string;
    contentType?: string;
    kind?: string;
    sizeBytes?: number;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.productId || !body?.filename || (body.kind !== "product" && body.kind !== "preview")) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const product = getProductById(body.productId);
  if (!product) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  if (typeof body.sizeBytes === "number" && body.sizeBytes > MAX_DECLARED_BYTES) {
    return NextResponse.json({ error: "FILE_TOO_LARGE", maxBytes: MAX_DECLARED_BYTES }, { status: 413 });
  }
  const filename = sanitizeFilename(body.filename);
  if (!filename) {
    return NextResponse.json(
      { error: "INVALID_FILENAME", allowedExtensions: ALLOWED_EXTENSIONS },
      { status: 400 },
    );
  }
  const fileKey =
    body.kind === "preview"
      ? previewFileKey(product.id, filename)
      : productFileKey(product.id, filename);
  const uploadUrl = presignPut(fileKey, body.contentType, 3600);
  if (!uploadUrl) {
    return NextResponse.json({ error: "STORAGE_NOT_CONFIGURED" }, { status: 503 });
  }
  return NextResponse.json({ uploadUrl, fileKey, expiresIn: 3600 });
}
