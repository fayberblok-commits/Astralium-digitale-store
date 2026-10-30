import { NextRequest, NextResponse } from "next/server";
import {
  analyticsCsv, dailySeries, funnel, listAnalyticsEvents, topProducts, utcDay,
} from "../../../../lib/analytics";
import { requireAdmin } from "../../../../lib/team";

export const runtime = "nodejs";

/**
 * Analytics dashboard data (Phase 6, feature 27): 30-day daily series,
 * funnel and top products over the stored first-party events. Zero
 * stored events → zero-filled series and empty lists (honest empties).
 * `?format=csv` returns the 30-day series as a CSV download.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const days = 30;
  const sinceDay = utcDay(new Date(Date.now() - (days - 1) * 24 * 3600 * 1000));
  const events = await listAnalyticsEvents({ sinceDay });
  const series = dailySeries(events, days);
  if (req.nextUrl.searchParams.get("format") === "csv") {
    return new NextResponse(analyticsCsv(series), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="astralium-analytics-30d.csv"',
      },
    });
  }
  return NextResponse.json({
    days,
    series,
    funnel: funnel(events),
    topProducts: topProducts(events, 10),
    totalEvents: events.length,
  });
}
