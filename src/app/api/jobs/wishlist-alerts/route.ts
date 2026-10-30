import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { safeEqual } from "../../../../lib/pii";
import { runPriceDropJob } from "../../../../lib/wishlist-alerts";

export const runtime = "nodejs";

/**
 * Cron endpoint for wishlist price-drop alerts (Phase 3, feature 8).
 * Auth: `x-cron-secret` header must match PRICE_ALERT_CRON_SECRET
 * (constant-time compare; unset secret → 503, never open). Flag-gated:
 * 403 while wishlist_alerts is off. Point any external cron (Vercel
 * Cron, GitHub Actions…) at this route with the header set.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.PRICE_ALERT_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET_NOT_CONFIGURED" }, { status: 503 });
  }
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!(await getFlag("wishlist_alerts"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const summary = await runPriceDropJob();
  return NextResponse.json({ ok: true, ...summary });
}
