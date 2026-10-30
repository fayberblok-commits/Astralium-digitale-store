import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { getFlag } from "../../../../lib/flags";
import { runScheduledGiftJob } from "../../../../lib/gifts";

export const runtime = "nodejs";

/**
 * Cron endpoint for scheduled gifts (Phase 4, feature 10). Auth:
 * `x-cron-secret` header must match CRON_SECRET (or the Phase-3
 * PRICE_ALERT_CRON_SECRET fallback); unset secret → 503, never open.
 * Flag-gated: 403 while gifts is off.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  if (!(await getFlag("gifts"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const summary = await runScheduledGiftJob();
  return NextResponse.json({ ok: true, ...summary });
}
