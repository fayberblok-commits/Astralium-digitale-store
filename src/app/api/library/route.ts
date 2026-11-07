import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { buildLibraryEntries, verifiedLibraryOrders, ledgerOrderToLibraryInput, versionMapFor, type LibraryOrderInput } from "../../../lib/library";
import { listAdminProducts } from "../../../lib/catalog";
import { getLoyaltyBalance } from "../../../lib/loyalty";
import { httpErrorResponse, readJsonBody } from "../../../lib/http";

export const runtime = "nodejs";

/**
 * My Library (Phase 3, feature 1).
 *
 * Ownership model (delivery-audit findings 71/72 — the previous
 * version trusted client claims and minted real download tokens for
 * wholly fabricated order records; that side door is closed):
 * entries are built ONLY from ledger orders the server holds as
 * paid/fulfilled, admitted through verifiedLibraryOrders. Admission
 * requires the unguessable provider reference (PayPal order id /
 * Stripe session id) from the buyer's own device records — the same
 * capability the success page verifies. A claimed status, a claimed
 * item list, or an email address alone admits nothing, and every
 * download URL handed out is the order's ledger GRANT token
 * (counted, capped, revocable) — never a freshly minted claim token.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("library"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  let body: {
    email?: string;
    localOrders?: { orderId: string; providerRef?: string; createdAt: string; status: string; items: { id: string; productIds?: string[] }[] }[];
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }

  // Product resolution runs against the real catalog (all products,
  //  incl. since-deactivated ones — a buyer keeps library access to
  //  what they paid for). The seed list alone dropped the real books.
  const { products: catalogAll } = await listAdminProducts();
  const catalogById = new Map(catalogAll.map((p) => [p.id, p]));
  const presented = Array.isArray(body?.localOrders) ? body.localOrders.slice(0, 50) : [];

  const verified = await verifiedLibraryOrders({ email: body?.email, records: presented });
  const orders: LibraryOrderInput[] = verified.orders.map(ledgerOrderToLibraryInput);
  const emailLc = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const source: "db" | "device" =
    emailLc && verified.orders.some((o) => o.email.trim().toLowerCase() === emailLc) ? "db" : "device";
  const versions = await versionMapFor(orders);
  const entries = buildLibraryEntries(
    orders,
    versions,
    (pid, oid) => verified.tokens.get(`${oid}:${pid}`) ?? null,
    catalogById,
  );
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
