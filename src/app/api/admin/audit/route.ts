import { NextRequest, NextResponse } from "next/server";
import { listAudit, requireAdmin } from "../../../../lib/team";

export const runtime = "nodejs";

/** Audit log viewer (Phase 6, feature 29): append-only, newest first. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "audit");
  if ("error" in auth) return auth.error;
  const entries = await listAudit(200);
  return NextResponse.json({ entries });
}
