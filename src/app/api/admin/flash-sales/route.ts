import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, type Permission } from "../../../../lib/team";
import {
  campaignState, deleteFlashSale, listFlashSales, saveFlashSale, type FlashSaleInput,
} from "../../../../lib/flash-sales";
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
  const now = new Date();
  const sales = await listFlashSales();
  return NextResponse.json({
    sales: sales.map((s) => ({ ...s, state: campaignState(s, now) })),
  });
}

/** Create/update a campaign (sanitized server-side; counters preserved). */
export async function POST(req: NextRequest) {
  const denied = await guard(req, "commerce");
  if (denied) return denied;
  let body: { sale?: FlashSaleInput } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.sale) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await saveFlashSale(body.sale);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "INVALID_CAMPAIGN" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, persisted: result.persisted, sale: result.sale });
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req, "commerce");
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  await deleteFlashSale(id);
  return NextResponse.json({ ok: true });
}
