import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { getFlag } from "../../../../lib/flags";
import { runPreorderReleaseJob } from "../../../../lib/preorders";

export const runtime = "nodejs";

/**
 * Cron endpoint for pre-order releases (Phase 4, feature 14): emails
 * buyers whose pre-ordered products just released. Auth: `x-cron-secret`
 * (CRON_SECRET or PRICE_ALERT_CRON_SECRET fallback); unset → 503.
 * Flag-gated: 403 while preorders is off. Without a database there is
 * no buyer list and the summary honestly reports orders: 0.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  if (!(await getFlag("preorders"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const summary = await runPreorderReleaseJob();
  return NextResponse.json({ ok: true, ...summary });
}
