import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { getLoyaltyBalance, getLoyaltyConfig, listLoyaltyEntries } from "../../../lib/loyalty";

export const runtime = "nodejs";

/**
 * Loyalty balance for the account page / checkout (Phase 4, feature 11).
 * Lookup is by the customer's own email; only aggregate balance, tier
 * and the customer's own ledger are returned. Flag-gated: 403 while off.
 */
export async function GET(req: NextRequest) {
  if (!(await getFlag("loyalty"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const email = req.nextUrl.searchParams.get("email") ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  const config = await getLoyaltyConfig();
  const balance = await getLoyaltyBalance(email, config);
  if (!balance) {
    return NextResponse.json({ balance: 0, lifetimeEarned: 0, tier: config.tiers[0]?.name ?? "Bronze", entries: [] });
  }
  const entries = await listLoyaltyEntries(email);
  return NextResponse.json({
    balance: balance.balance,
    lifetimeEarned: balance.lifetimeEarned,
    tier: balance.tier.name,
    pointValueUSD: config.pointValueUSD,
    maxRedeemPercent: config.maxRedeemPercent,
    entries: entries.slice(-20),
  });
}
