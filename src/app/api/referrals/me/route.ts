import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { getReferralConfig, referralLink, referralStats } from "../../../../lib/referrals";
import { siteUrl } from "../../../../lib/server";

export const runtime = "nodejs";

/**
 * The customer's own referral code + stats (Phase 4, feature 12).
 * Get-or-create by email; returns the shareable link and recorded
 * commission totals (pending vs earned). Flag-gated: 403 while off.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("referrals"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { email?: string; locale?: string } | null;
  const email = (body?.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  const stats = await referralStats(email);
  if (!stats) return NextResponse.json({ error: "UNAVAILABLE" }, { status: 503 });
  const config = await getReferralConfig();
  return NextResponse.json({
    code: stats.code,
    link: referralLink(siteUrl(), stats.code, body?.locale ?? "en"),
    commissionPercent: config.commissionPercent,
    orders: stats.orders,
    earnedUSD: stats.earnedUSD,
    pendingUSD: stats.pendingUSD,
  });
}
