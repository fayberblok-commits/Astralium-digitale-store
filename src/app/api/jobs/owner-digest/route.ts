import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { getFlag } from "../../../../lib/flags";
import { runOwnerDigest } from "../../../../lib/owner-alerts";

export const runtime = "nodejs";

/**
 * Owner-alert email digest job (Phase 6, feature 26). Cron-secret
 * guarded like the other /api/jobs routes. Sends ONE digest email with
 * the events recorded since the previous digest — never one per event.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  if (!(await getFlag("owner_alerts"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const summary = await runOwnerDigest();
  return NextResponse.json({ ok: true, ...summary });
}
