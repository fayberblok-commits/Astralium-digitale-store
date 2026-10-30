import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/team";
import { listCommissions } from "../../../../lib/referrals";

export const runtime = "nodejs";

/**
 * Owner panel data (Phase 4, feature 12): every recorded referral
 * commission. Payouts are recorded-only — the owner pays affiliates
 * manually; there is no payout integration by design.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const commissions = await listCommissions();
  const totals = {
    pendingUSD: Math.round(commissions.filter((c) => c.status === "pending").reduce((s, c) => s + c.commissionUSD, 0) * 100) / 100,
    earnedUSD: Math.round(commissions.filter((c) => c.status === "earned").reduce((s, c) => s + c.commissionUSD, 0) * 100) / 100,
  };
  return NextResponse.json({ commissions, totals, payouts: "recorded-only" });
}
