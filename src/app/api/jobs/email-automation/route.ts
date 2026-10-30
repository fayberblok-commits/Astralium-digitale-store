import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { getFlag } from "../../../../lib/flags";
import { runEmailAutomationJobs } from "../../../../lib/email-automation";

export const runtime = "nodejs";

/**
 * Cron endpoint for email automation (Phase 5, feature 20): abandoned-
 * cart recovery, review requests, win-back. Auth via the shared
 * cron-secret check (x-cron-secret header; unset secret → 503, wrong →
 * 401). Flag-gated: 403 while email_automation is off. The summary
 * reports real counts, including dbConfigured:false when review/win-back
 * had no order ledger to read.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  if (!(await getFlag("email_automation"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const summary = await runEmailAutomationJobs();
  return NextResponse.json({ ok: true, ...summary });
}
