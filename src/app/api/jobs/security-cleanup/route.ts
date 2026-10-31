import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { runSecurityCleanup } from "../../../../lib/cleanup";

export const runtime = "nodejs";

/**
 * Periodic cleanup (Phase 1 upgrade, §11): expired claim codes, stale
 * login guards, security-log retention. Cron-secret guarded.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  const summary = await runSecurityCleanup();
  return NextResponse.json({ ok: true, ...summary });
}
