import { NextRequest, NextResponse } from "next/server";
import { verifyDownloadToken } from "../../../../lib/tokens";
import { getProductById } from "../../../../data/products";
import { getBinding } from "../../../../lib/bindings";
import { isStorageConfigured, presignGet } from "../../../../services/storage";

export const runtime = "nodejs";

/**
 * Token-gated download. Verifies the HMAC signature + expiry, then resolves
 * the product's file binding (DB Product.fileKey → local .data store →
 * catalog): when a real file is bound and storage is configured, the buyer
 * is 302-redirected to a 15-minute presigned S3 GET URL — raw storage URLs
 * are never handed out. Otherwise it falls back to the generated licensed
 * deliverable (the pipeline proof used before product files are uploaded).
 * Expiry and the download cap (`max`) travel inside the signed token.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = verifyDownloadToken(decodeURIComponent(token));
  if (!result.ok) {
    return NextResponse.json({ error: "INVALID_OR_EXPIRED_LINK", reason: result.reason }, { status: 403 });
  }
  const product = getProductById(result.payload.pid);
  if (!product) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  // Real file bound? Redirect to a short-lived presigned URL.
  if (isStorageConfigured()) {
    try {
      const binding = await getBinding(product.id);
      if (binding?.fileKey) {
        const url = presignGet(binding.fileKey, 900);
        if (url) {
          return NextResponse.redirect(url, {
            status: 302,
            headers: { "Cache-Control": "private, no-store", "X-Order-Id": result.payload.oid },
          });
        }
      }
    } catch {
      // Binding lookup must never break delivery — fall through to fallback.
    }
  }
  const expiresISO = new Date(result.payload.exp * 1000).toISOString();
  const content = [
    `ASTRALIUM DIGITALE STORE — LICENSED DELIVERABLE`,
    `================================================`,
    `Product : ${product.title}`,
    `Order   : ${result.payload.oid}`,
    `Issued  : for the buyer of order ${result.payload.oid} only — do not share.`,
    `Formats : ${product.formats.map((f) => `${f.format} (${f.sizeMB} MB)`).join(", ")}`,
    `Link cap: ${result.payload.max} downloads · valid until ${expiresISO}`,
    ``,
    `— Preview / sample content —`,
    product.preview,
    ``,
    `Full production files for this product are served from the storage`,
    `adapter (S3) in the deployment configuration; this generated package`,
    `proves the signed-delivery pipeline end to end.`,
  ].join("\n");
  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${product.slug}-deliverable.txt"`,
      "Cache-Control": "private, no-store",
      "X-Order-Id": result.payload.oid,
    },
  });
}
