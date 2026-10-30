import { NextRequest, NextResponse } from "next/server";
import { verifyDownloadToken } from "../../../../lib/tokens";
import { getProductById } from "../../../../data/products";

export const runtime = "nodejs";

/**
 * Token-gated download. Verifies the HMAC signature + expiry, then streams
 * a generated deliverable for the product. In production the bytes come
 * from the S3 storage adapter; in this release the deliverable is the
 * product's licensed sample package (text), generated deterministically.
 * Download counts (`max` in the token) are enforced by the DB adapter
 * phase — the token itself carries the cap (see docs/LIMITATIONS.md).
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
