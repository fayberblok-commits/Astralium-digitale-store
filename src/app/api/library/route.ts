import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { buildLibraryEntries, ordersForEmailDb, localOrdersToInputs, versionMapFor, type LibraryOrderInput } from "../../../lib/library";
import { getLoyaltyBalance } from "../../../lib/loyalty";

export const runtime = "nodejs";

/**
 * My Library (Phase 3, feature 1).
 *
 * Two ownership-checked sources, never mixed:
 *  - DB mode: ?email= returns ONLY orders whose stored email matches —
 *    the email is in the SQL WHERE clause (see ordersForEmailDb).
 *  - Device mode: the browser posts back its own local order records;
 *    entries are built from exactly those records (the same trust model
 *    as the existing account page) and downloads re-mint fresh signed
 *    tokens through the existing grant flow.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("library"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    localOrders?: { orderId: string; createdAt: string; status: string; items: { id: string; productIds?: string[] }[] }[];
  } | null;

  let orders: LibraryOrderInput[] = [];
  let source: "db" | "device" = "device";
  if (body?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    const dbOrders = await ordersForEmailDb(body.email);
    if (dbOrders !== null) {
      orders = dbOrders;
      source = "db";
    }
  }
  if (source === "device" && Array.isArray(body?.localOrders)) {
    orders = localOrdersToInputs(body.localOrders.slice(0, 50));
  }
  const versions = await versionMapFor(orders);
  const entries = buildLibraryEntries(orders, versions);
  // Phase 4, feature 11: loyalty balance rides along when the customer
  // identified themselves with an email and the flag is on.
  let loyalty: { balance: number; tier: string } | null = null;
  if (body?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) && (await getFlag("loyalty"))) {
    const balance = await getLoyaltyBalance(body.email);
    if (balance) loyalty = { balance: balance.balance, tier: balance.tier.name };
  }
  return NextResponse.json({
    source,
    loyalty,
    entries: entries.map((e) => ({
      orderId: e.orderId,
      purchasedAt: e.purchasedAt,
      productId: e.product.id,
      slug: e.product.slug,
      title: e.product.title,
      purchasedVersion: e.purchasedVersion,
      latestVersion: e.latestVersion,
      updated: e.updated,
      downloadUrl: e.downloadUrl,
    })),
  });
}
