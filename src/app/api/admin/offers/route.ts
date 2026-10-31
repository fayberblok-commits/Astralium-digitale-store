import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, type Permission } from "../../../../lib/team";
import { getOfferConfig, setOfferConfig, type OfferConfig } from "../../../../lib/offers";
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
  return NextResponse.json({ config: await getOfferConfig() });
}

/** Replace the whole offer config (sanitized server-side in offers.ts). */
export async function POST(req: NextRequest) {
  const denied = await guard(req, "content");
  if (denied) return denied;
  let body: { config?: OfferConfig } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.config || typeof body.config !== "object") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const { persisted } = await setOfferConfig(body.config);
  return NextResponse.json({ ok: true, persisted, config: await getOfferConfig() });
}
