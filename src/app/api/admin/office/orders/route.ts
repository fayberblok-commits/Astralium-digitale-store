import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import { listAllOrders, type OrderRecord } from "../../../../../lib/orders";

export const runtime = "nodejs";

/**
 * Manager's Office — order list (Phase 4 upgrade, item 3).
 * Search (id / email / provider ref), status filter, pagination —
 * all over the Phase-1 ledger. `read` permission: every office role
 * may look; money actions live on the detail/refund routes.
 */
function summary(o: OrderRecord) {
  return {
    id: o.id, email: o.email, status: o.status, totalUSD: o.totalUSD, refundUSD: o.refundUSD,
    currency: o.currency, provider: o.provider, providerRef: o.providerRef,
    country: o.country, locale: o.locale, items: o.items.length, createdAt: o.createdAt,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const status = sp.get("status") ?? "";
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(sp.get("pageSize") ?? 20) || 20));

  let orders = await listAllOrders();
  if (status) orders = orders.filter((o) => o.status === status);
  if (q) {
    orders = orders.filter((o) =>
      o.id.toLowerCase().includes(q) || o.email.toLowerCase().includes(q) || o.providerRef.toLowerCase().includes(q));
  }
  const total = orders.length;
  const slice = orders.slice((page - 1) * pageSize, page * pageSize);
  return NextResponse.json({ orders: slice.map(summary), total, page, pageSize, pages: Math.ceil(total / pageSize) });
}
