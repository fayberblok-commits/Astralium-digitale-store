import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin } from "../../../../../../lib/team";
import { findOrder, listGrantsForOrder, setOrderNote } from "../../../../../../lib/orders";
import { deliverOrder } from "../../../../../../services/delivery";
import { httpErrorResponse, readJsonBody } from "../../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Manager's Office — order detail + support actions (Phase 4 upgrade).
 * GET: the full ledger record + grant states (token hashes are never
 * returned). POST actions: `note` (owner's private note) and `resend`
 * (re-deliver the order's downloads through the delivery orchestrator,
 * email channel). Both need `support_ops` and are audit-logged.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const order = await findOrder(decodeURIComponent(id));
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  const grants = await listGrantsForOrder(order.id);
  return NextResponse.json({
    order,
    grants: grants.map((g) => ({
      id: g.id, productId: g.productId, downloadsCount: g.downloadsCount,
      maxDownloads: g.maxDownloads, expiresAt: g.expiresAt, revokedAt: g.revokedAt, createdAt: g.createdAt,
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, "support_ops");
  if ("error" in auth) return auth.error;
  const { id } = await ctx.params;
  const order = await findOrder(decodeURIComponent(id));
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  let body: { action?: string; note?: string } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }

  if (body?.action === "note") {
    const res = await setOrderNote(order.id, typeof body.note === "string" ? body.note : "");
    if (!res.ok) return NextResponse.json({ error: "NOTE_FAILED" }, { status: 500 });
    await recordAudit({ actor: auth.actor, action: "office.order_note", target: order.id });
    return NextResponse.json({ ok: true, note: res.order?.note ?? "" });
  }

  if (body?.action === "resend") {
    if (order.status !== "paid" && order.status !== "fulfilled") {
      return NextResponse.json({ error: "ORDER_NOT_PAID" }, { status: 409 });
    }
    const outcome = await deliverOrder(
      { orderId: order.id, email: order.email, productIds: order.items.map((i) => i.productId) },
      "email",
    );
    await recordAudit({
      actor: auth.actor, action: "office.order_resend", target: order.id,
      detail: { deliveredVia: outcome.deliveredVia, alreadyDelivered: outcome.alreadyDelivered },
    });
    return NextResponse.json({
      ok: outcome.deliveredVia !== null || outcome.alreadyDelivered,
      deliveredVia: outcome.deliveredVia,
      alreadyDelivered: outcome.alreadyDelivered,
      reason: outcome.reason ?? null,
    });
  }

  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
