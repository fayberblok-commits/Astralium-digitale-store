import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { runOrderReconcile } from "../../../../lib/reconcile";

export const runtime = "nodejs";

/**
 * Missed-refund recovery (Phase 1 upgrade, §8): re-checks paid Stripe
 * orders against the Stripe API and applies refunds whose webhook
 * events were lost. Cron-secret guarded like every /api/jobs route.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  const summary = await runOrderReconcile();
  return NextResponse.json({ ok: true, ...summary });
}
