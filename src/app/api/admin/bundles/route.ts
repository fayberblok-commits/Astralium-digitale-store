import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, type Permission } from "../../../../lib/team";
import { getProductById } from "../../../../data/products";
import { listStoredBundles, saveStoredBundle, deleteStoredBundle } from "../../../../lib/bundles";
import { computeBundlePrice } from "../../../../lib/byo";
import { PRODUCTS } from "../../../../data/products";
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
  const { persisted, bundles } = await listStoredBundles();
  return NextResponse.json({
    persisted,
    bundles: bundles.map((b) => ({
      ...b,
      derived: computeBundlePrice(b.productIds, b.discountPercent, PRODUCTS),
    })),
  });
}

/** Create or edit a bundle. Price is derived server-side — never input. */
export async function POST(req: NextRequest) {
  const denied = await guard(req, "content");
  if (denied) return denied;
  let body: {
    id?: string; title?: string; description?: string;
    productIds?: string[]; discountPercent?: number; active?: boolean;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.title || !Array.isArray(body.productIds) || body.productIds.length < 2) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (!body.productIds.every((id) => getProductById(id))) {
    return NextResponse.json({ error: "UNKNOWN_PRODUCT" }, { status: 400 });
  }
  const pct = Math.min(90, Math.max(0, Math.round(Number(body.discountPercent) || 0)));
  const { persisted, bundle } = await saveStoredBundle({
    id: body.id, title: body.title.slice(0, 120), description: body.description?.slice(0, 500),
    productIds: Array.from(new Set(body.productIds)), discountPercent: pct, active: body.active,
  });
  return NextResponse.json({
    ok: true, persisted, bundle,
    derived: computeBundlePrice(bundle.productIds, bundle.discountPercent, PRODUCTS),
  });
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req, "content");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const result = await deleteStoredBundle(id);
  return NextResponse.json({ ok: result.deleted, persisted: result.persisted });
}
