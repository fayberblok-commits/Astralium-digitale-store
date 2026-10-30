import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { getFlag } from "../../../../lib/flags";
import { runDunningJob } from "../../../../lib/subscriptions";

export const runtime = "nodejs";

/**
 * Cron endpoint for subscription dunning (Phase 4, feature 15): sends
 * the failed-payment reminder sequence (offsets 0/3/7 days) for
 * past_due subscriptions and advances each record's step. Auth:
 * `x-cron-secret` (CRON_SECRET or PRICE_ALERT_CRON_SECRET fallback);
 * unset → 503. Flag-gated: 403 while subscriptions is off.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  if (!(await getFlag("subscriptions"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const summary = await runDunningJob();
  return NextResponse.json({ ok: true, ...summary });
}
