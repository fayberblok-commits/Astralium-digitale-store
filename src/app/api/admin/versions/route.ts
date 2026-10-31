import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, type Permission } from "../../../../lib/team";
import { getProductById } from "../../../../data/products";
import { getBinding } from "../../../../lib/bindings";
import { listVersions, publishVersion } from "../../../../lib/versions";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

// Phase 6 (feature 29): role-based guard — GET needs "read", mutations
// need this route's permission (see the matrix in lib/team.ts). The
// ADMIN_PASSWORD bootstrap session acts as owner and passes everything.
async function guard(req: NextRequest, permission: Permission): Promise<Response | null> {
  const res = await requireAdmin(req, permission);
  return "error" in res ? res.error : null;
}

export async function GET(req: NextRequest) {
  const denied = await guard(req, "read");
  if (denied) return denied;
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId || !getProductById(productId)) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ versions: await listVersions(productId) });
}

/**
 * Publish a new product version (Phase 3, feature 1). The file must
 * already be uploaded + bound through the Phase-1 files flow; this
 * records the version, repoints the binding (existing download links
 * keep working) and queues update emails to buyers when a DB provides
 * the buyer list.
 */
export async function POST(req: NextRequest) {
  const denied = await guard(req, "content");
  if (denied) return denied;
  let body: {
    productId?: string; version?: string; fileKey?: string; notes?: string;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.productId || !getProductById(body.productId)) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  if (!body.version || !/^\d+\.\d+(\.\d+)?$/.test(body.version)) {
    return NextResponse.json({ error: "INVALID_VERSION" }, { status: 400 });
  }
  // Default to the currently bound deliverable when no new key is given.
  const binding = await getBinding(body.productId);
  const fileKey = body.fileKey ?? binding?.fileKey;
  if (!fileKey) {
    return NextResponse.json({ error: "NO_FILE_BOUND", hint: "Upload the new file via the Product files flow first." }, { status: 409 });
  }
  if (!fileKey.startsWith(`products/${body.productId}/`)) {
    return NextResponse.json({ error: "KEY_OUTSIDE_PRODUCT_NAMESPACE" }, { status: 400 });
  }
  const result = await publishVersion({
    productId: body.productId, version: body.version, fileKey, notes: body.notes?.slice(0, 500),
  });
  return NextResponse.json({ ok: true, ...result });
}
