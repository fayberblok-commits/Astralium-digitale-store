import { NextRequest, NextResponse } from "next/server";
import { verifyDownloadToken } from "../../../../lib/tokens";
import { listAdminProducts } from "../../../../lib/catalog";
import { getBinding } from "../../../../lib/bindings";
import { getFlag } from "../../../../lib/flags";
import { downloadGate } from "../../../../lib/preorders";
import { isOrderHeld } from "../../../../lib/fraud";
import { fetchStampedPdf, watermarkLine } from "../../../../lib/watermark";
import { getDb } from "../../../../lib/db";
import { isStorageConfigured, presignGet } from "../../../../services/storage";
// Phase 1 upgrade (F1/§8): ledger grants are the revocable, counted
// enforcement layer on top of the signed token.
import { consumeGrantDownload, getGrantByToken } from "../../../../lib/orders";

export const runtime = "nodejs";

/**
 * Buyer email for the watermark line, resolved from the persisted order
 * when one exists (DB orders carry the email; the id here is the store
 * order id, matched against both the row id and the provider reference).
 * Returns null when unresolvable — the line then carries the order id
 * only. An email is never invented.
 */
async function resolveOrderEmail(orderId: string): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const order = await db.order.findFirst({
      where: { OR: [{ id: orderId }, { providerRef: orderId }] },
      select: { email: true },
    });
    return order?.email ?? null;
  } catch {
    return null;
  }
}

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
  // Resolve from the real catalog (DB-first, all products incl.
  // inactive — a buyer keeps access to what they paid for). The seed
  // list alone 404'd every office-created product's download.
  const { products: catalogAll } = await listAdminProducts();
  const product = catalogAll.find((p) => p.id === result.payload.pid) ?? null;
  if (!product) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  // Pre-orders (Phase 4, feature 14): the grant exists from payment, but
  // the file stays sealed until the release instant — enforced here,
  // server-side, so a leaked or early link cannot beat the release.
  if (await getFlag("preorders")) {
    const gate = await downloadGate(product.id);
    if (!gate.allowed) {
      return NextResponse.json(
        { error: "PREORDER_NOT_RELEASED", releaseDate: gate.releaseDate },
        { status: 403 },
      );
    }
  }
  // Fraud shield (Phase 5, feature 19): a HELD order's files stay sealed
  // until the owner releases the hold in admin — even with a valid token.
  if (await getFlag("fraud_shield")) {
    if (await isOrderHeld(result.payload.oid)) {
      return NextResponse.json({ error: "ORDER_HELD" }, { status: 403 });
    }
  }
  // Ledger grant enforcement (F1/§8): when this token was issued as a
  // grant, a revocation (refund/dispute) refuses the download even
  // though the token itself still verifies. The download COUNT is
  // consumed only once the file is actually about to be served
  // (thermal fix) — it used to burn on requests that then failed to
  // deliver anything, and its own failures were swallowed silently.
  // Tokens without a grant row (issued before the ledger) keep the
  // token's own embedded expiry/cap semantics.
  const grant = await getGrantByToken(decodeURIComponent(token)).catch(() => null);
  if (grant?.revokedAt) {
    return NextResponse.json({ error: "GRANT_REVOKED" }, { status: 403 });
  }
  const consumeGrant = async (): Promise<NextResponse | null> => {
    if (!grant) return null;
    let counted = true;
    try {
      counted = await consumeGrantDownload(grant);
    } catch (err) {
      // Cap enforcement failing open is acceptable ONLY when loud.
      console.log(JSON.stringify({ event: "download.grant-consume-failed", orderId: result.payload.oid, productId: product.id, error: String(err) }));
      return null;
    }
    if (!counted) {
      return NextResponse.json({ error: "DOWNLOAD_LIMIT_REACHED" }, { status: 403 });
    }
    return null;
  };
  // Real file bound? Redirect to a short-lived presigned URL.
  if (isStorageConfigured()) {
    let binding: Awaited<ReturnType<typeof getBinding>> = null;
    try {
      binding = await getBinding(product.id);
    } catch (err) {
      // With storage configured, a binding lookup failure leaves the
      // delivery state UNKNOWN — serving the placeholder then would
      // hand a paying buyer a fake deliverable. Honest 502 instead:
      // no grant count is consumed and the buyer can retry.
      console.log(JSON.stringify({ event: "download.binding-lookup-failed", orderId: result.payload.oid, productId: product.id, error: String(err) }));
      return NextResponse.json({ error: "DELIVERY_TEMPORARILY_UNAVAILABLE" }, { status: 502 });
    }
    if (binding?.fileKey) {
      // PDF watermarking (Phase 5, feature 17): PDFs are pulled through
      // the app and served as a stamped copy (buyer email + order id on
      // every page); the stored original is never modified. Encrypted/
      // corrupt PDFs fall back to the original bytes with a log note.
      // Non-PDFs keep the presigned redirect below.
      if (await getFlag("watermarking")) {
        const email = await resolveOrderEmail(result.payload.oid);
        const fetched = await fetchStampedPdf(binding.fileKey, watermarkLine(email, result.payload.oid));
        if (fetched) {
          const refused = await consumeGrant();
          if (refused) return refused;
          return new NextResponse(Buffer.from(fetched.bytes), {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="${product.slug}.pdf"`,
              "Cache-Control": "private, no-store",
              "X-Order-Id": result.payload.oid,
              "X-Watermarked": fetched.stamped ? "1" : "0",
            },
          });
        }
      }
      const url = presignGet(binding.fileKey, 900);
      if (url) {
        const refused = await consumeGrant();
        if (refused) return refused;
        return NextResponse.redirect(url, {
          status: 302,
          headers: { "Cache-Control": "private, no-store", "X-Order-Id": result.payload.oid },
        });
      }
      // A real file IS bound but could not be fetched or signed: the
      // placeholder below must never masquerade as this product's
      // delivery. 502, logged, grant count untouched.
      console.log(JSON.stringify({ event: "download.bound-file-unavailable", orderId: result.payload.oid, productId: product.id, fileKey: binding.fileKey }));
      return NextResponse.json({ error: "DELIVERY_TEMPORARILY_UNAVAILABLE" }, { status: 502 });
    }
  }
  // No real file is bound for this product: the generated licensed
  // deliverable is the delivery (pipeline proof). The grant count is
  // consumed now — at the serve decision, not before it.
  const refused = await consumeGrant();
  if (refused) return refused;
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
