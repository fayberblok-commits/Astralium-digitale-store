import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { assembleExport, consumePrivacyRequest, requestEmail } from "../../../../lib/privacy";

export const runtime = "nodejs";

/**
 * Download a data export (Phase 6, feature 30). The token is consumed
 * by this download — single-use. Only `export` requests resolve here;
 * a deletion token is rejected so the two flows can never be confused.
 */
export async function GET(req: NextRequest) {
  if (!(await getFlag("privacy_center"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const token = req.nextUrl.searchParams.get("token") ?? "";
  // Peek first (resolve via consume would burn a delete token wrongly):
  const { resolvePrivacyRequest } = await import("../../../../lib/privacy");
  const pending = await resolvePrivacyRequest(token);
  if (!pending || pending.kind !== "export") {
    return NextResponse.json({ error: "LINK_INVALID_OR_EXPIRED" }, { status: 400 });
  }
  const email = requestEmail(pending) ?? "";
  const rec = await consumePrivacyRequest(token);
  if (!rec || !email) {
    return NextResponse.json({ error: "LINK_INVALID_OR_EXPIRED" }, { status: 400 });
  }
  const data = await assembleExport(email);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="astralium-data-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
