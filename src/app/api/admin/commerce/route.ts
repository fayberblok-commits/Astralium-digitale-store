import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, type Permission } from "../../../../lib/team";
import { getPwywConfig, setPwywConfig, type PwywConfig } from "../../../../lib/pwyw";
import { getPreorderConfig, setPreorderConfig, type PreorderConfig } from "../../../../lib/preorders";
import { getLoyaltyConfig, setLoyaltyConfig, type LoyaltyConfig } from "../../../../lib/loyalty";
import { getReferralConfig, setReferralConfig, type ReferralConfig } from "../../../../lib/referrals";
import { getPlanConfig, setPlanConfig, type SubscriptionPlanConfig } from "../../../../lib/subscriptions";

export const runtime = "nodejs";

// Phase 6 (feature 29): role-based guard — GET needs "read", mutations
// need this route's permission (see the matrix in lib/team.ts). The
// ADMIN_PASSWORD bootstrap session acts as owner and passes everything.
async function guard(req: NextRequest, permission: Permission): Promise<Response | null> {
  const res = await requireAdmin(req, permission);
  return "error" in res ? res.error : null;
}

/**
 * Phase 4 commerce configuration (features 11–15): PWYW, pre-orders,
 * loyalty, referrals and subscription plans in one document. Every
 * value is sanitized server-side against the catalog before persisting.
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req, "read");
  if (denied) return denied;
  return NextResponse.json({
    pwyw: await getPwywConfig(),
    preorders: await getPreorderConfig(),
    loyalty: await getLoyaltyConfig(),
    referrals: await getReferralConfig(),
    plans: await getPlanConfig(),
  });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req, "commerce");
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    pwyw?: PwywConfig;
    preorders?: PreorderConfig;
    loyalty?: LoyaltyConfig;
    referrals?: ReferralConfig;
    plans?: SubscriptionPlanConfig;
  } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const persisted: Record<string, string> = {};
  if (body.pwyw) persisted.pwyw = (await setPwywConfig(body.pwyw)).persisted;
  if (body.preorders) persisted.preorders = (await setPreorderConfig(body.preorders)).persisted;
  if (body.loyalty) persisted.loyalty = (await setLoyaltyConfig(body.loyalty)).persisted;
  if (body.referrals) persisted.referrals = (await setReferralConfig(body.referrals)).persisted;
  if (body.plans) persisted.plans = (await setPlanConfig(body.plans)).persisted;
  return NextResponse.json({
    ok: true,
    persisted,
    pwyw: await getPwywConfig(),
    preorders: await getPreorderConfig(),
    loyalty: await getLoyaltyConfig(),
    referrals: await getReferralConfig(),
    plans: await getPlanConfig(),
  });
}
