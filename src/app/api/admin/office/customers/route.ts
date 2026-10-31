import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin } from "../../../../../lib/team";
import { listAllOrders } from "../../../../../lib/orders";
import { aggregateCustomers } from "../../../../../lib/office-finance";
import { addToBlacklist, isBlacklisted, listBlacklist, removeFromBlacklist } from "../../../../../lib/fraud";
import { hashEmail } from "../../../../../lib/reviews";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Manager's Office — customers (Phase 4 upgrade, item 3).
 *
 * Customers are aggregated from the order ledger (there is no separate
 * customer table — guest checkout is email-based). Banning writes to
 * the fraud shield's hash-only blacklist, which checkout already
 * enforces (a banned email is refused before payment). Only the hash
 * is ever stored; the office maps it back to the ledger emails it
 * already knows.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const customers = aggregateCustomers(await listAllOrders());
  const withBan = await Promise.all(
    customers.map(async (c) => ({ ...c, banned: await isBlacklisted(c.email) })),
  );
  return NextResponse.json({ customers: withBan });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "commerce");
  if ("error" in auth) return auth.error;
  let body: { action?: string; email?: string } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 8 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  if (body?.action === "ban") {
    await addToBlacklist(email, "Banned from the Manager's Office");
    await recordAudit({ actor: auth.actor, action: "office.customer_ban", target: email });
    return NextResponse.json({ ok: true, banned: true });
  }
  if (body?.action === "unban") {
    const record = (await listBlacklist()).find((b) => b.emailHash === hashEmail(email));
    if (record) await removeFromBlacklist(record.id);
    await recordAudit({ actor: auth.actor, action: "office.customer_unban", target: email });
    return NextResponse.json({ ok: true, banned: false });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
