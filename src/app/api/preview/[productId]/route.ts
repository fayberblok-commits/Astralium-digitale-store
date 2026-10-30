import { NextRequest, NextResponse } from "next/server";
import { getProductById } from "../../../../data/products";
import { getBinding } from "../../../../lib/bindings";
import { getFlag } from "../../../../lib/flags";
import { headObject, isStorageConfigured, presignGet } from "../../../../services/storage";
import { buildPreviewFallbackDoc, previewMaxBytes, previewSizeAllowed } from "../../../../lib/preview";

export const runtime = "nodejs";

/**
 * Free preview serving (Phase 3, feature 2).
 *
 * With storage configured AND a preview asset bound: HEAD-check the
 * object against PREVIEW_MAX_MB, then 302 to a 5-minute presigned GET.
 * Oversized previews are refused (413) — previews stay small by policy.
 * Without storage, the catalog preview text is served as a formatted
 * sample document so the preview block always works.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  if (!(await getFlag("previews"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const { productId } = await params;
  const product = getProductById(productId);
  if (!product) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  if (isStorageConfigured()) {
    try {
      const binding = await getBinding(product.id);
      if (binding?.previewKey) {
        const head = await headObject(binding.previewKey);
        if (head.exists) {
          if (!previewSizeAllowed(head.contentLength, previewMaxBytes())) {
            return NextResponse.json(
              { error: "PREVIEW_TOO_LARGE", maxMB: previewMaxBytes() / (1024 * 1024) },
              { status: 413 },
            );
          }
          const url = presignGet(binding.previewKey, 300);
          if (url) {
            return NextResponse.redirect(url, {
              status: 302,
              headers: { "Cache-Control": "private, no-store" },
            });
          }
        }
      }
    } catch {
      // fall through to the built-in sample document
    }
  }
  return new NextResponse(buildPreviewFallbackDoc(product), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Preview-Source": "catalog-fallback",
    },
  });
}
