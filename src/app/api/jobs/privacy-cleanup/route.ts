import { NextRequest, NextResponse } from "next/server";
import { checkCronSecret, cronErrorStatus } from "../../../../lib/cron";
import { getPrivacyConfig, cleanupPrivacyRequests } from "../../../../lib/privacy";
import { pruneAnalyticsEvents } from "../../../../lib/analytics";
import { pruneReadOwnerEvents } from "../../../../lib/owner-alerts";

export const runtime = "nodejs";

/**
 * Retention cleanup job (Phase 6, feature 30): applies the admin's
 * retention-days setting to analytics events, expired privacy requests
 * and read owner alerts. Cron-secret guarded; reports exact counts.
 */
export async function POST(req: NextRequest) {
  const check = checkCronSecret(req);
  if (check !== "ok") {
    const { error, status } = cronErrorStatus(check);
    return NextResponse.json({ error }, { status });
  }
  const config = await getPrivacyConfig();
  const [analyticsRemoved, requests, alertsRemoved] = await Promise.all([
    pruneAnalyticsEvents(config.retentionDays),
    cleanupPrivacyRequests(config.retentionDays),
    pruneReadOwnerEvents(config.retentionDays),
  ]);
  return NextResponse.json({
    ok: true,
    retentionDays: config.retentionDays,
    analyticsRemoved,
    privacyRequestsExpired: requests.expired,
    privacyRequestsScrubbed: requests.scrubbed,
    ownerAlertsRemoved: alertsRemoved,
  });
}
