import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import {
  activeVisitors, dimensionCounts, funnel, listAnalyticsEvents, rangeStats, topPages, utcDay,
} from "../../../../../lib/analytics";

export const runtime = "nodejs";

/**
 * Manager's Office — live overview (Phase 4 upgrade, item 1).
 *
 * Everything is aggregated from the store's FIRST-PARTY analytics
 * events (lib/analytics.ts): no third-party trackers, no raw IPs, and
 * the consent gate is enforced at capture time. With zero traffic the
 * answer is honest zeros and empty lists — never invented numbers.
 * "Visitors now" = distinct visitor hashes with an event in the last
 * 5 minutes (event-based presence; there is no heartbeat).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;

  const now = new Date();
  const today = utcDay(now);
  const dayAgo = (n: number) => utcDay(new Date(now.getTime() - n * 24 * 3600 * 1000));
  const sinceDay = dayAgo(30);
  const events = await listAnalyticsEvents({ sinceDay });

  const last30 = events; // listAnalyticsEvents is already scoped to >= sinceDay
  const purchases = last30.filter((e) => e.type === "purchase").length;
  const pageviews = last30.filter((e) => e.type === "pageview").length;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    activeNow: activeVisitors(events, 5, now).visitors,
    ranges: {
      today: rangeStats(events, today, today),
      week: rangeStats(events, dayAgo(6), today),
      month: rangeStats(events, dayAgo(29), today),
    },
    countries: dimensionCounts(last30, (e) => e.country, 20),
    devices: dimensionCounts(last30, (e) => e.device, 8),
    browsers: dimensionCounts(last30, (e) => e.browser, 8),
    sources: dimensionCounts(last30, (e) => e.source, 12),
    topPages: topPages(last30, 10),
    funnel: funnel(last30),
    conversionRate: pageviews > 0 ? Math.round((purchases / pageviews) * 1000) / 10 : 0,
    totalEvents30d: last30.length,
  });
}
