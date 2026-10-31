import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin, requireStepUp } from "../../../../../../../lib/team";
import { findOrder, recordRefund, refundStateAfter } from "../../../../../../../lib/orders";
import { executeProviderRefund } from "../../../../../../../lib/refunds";
import { recordSecurityEvent } from "../../../../../../../lib/security-log";
import { httpErrorResponse, readJsonBody } from "../../../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Manager's Office — refund execution (Phase 4 upgrade, item 3).
 *
 * The most guarded route in the office: `finance` permission (owner /
 * accountant) AND a fresh step-up token (Phase-1 re-auth). The order
 * of operations is money-safe:
 *   1. validate the amount against the ledger (refundStateAfter),
 *   2. execute the refund with the REAL provider API,
 *   3. only then record it in the ledger (recordRefund) — a full
 *      refund also revokes the download grants.
 * If the provider is not configured the route refuses with
 * PAYMENTS_NOT_CONFIGURED and the ledger is left untouched — a refund
 * is never merely "recorded" as if it had happened.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, "finance");
  if ("error" in auth) return auth.error;
  const stepUp = await requireStepUp(req, auth.actor);
  if ("error" in stepUp) return stepUp.error;

  const { id } = await ctx.params;
  const order = await findOrder(decodeURIComponent(id));
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });

  let body: { amountUSD?: number } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 8 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const remaining = Math.round((order.totalUSD - order.refundUSD) * 100) / 100;
  const amount = typeof body?.amountUSD === "number" ? body.amountUSD : remaining;
  const plan = refundStateAfter(order, amount);
  if ("error" in plan) {
    return NextResponse.json({ error: plan.error }, { status: 409 });
  }

  const outcome = await executeProviderRefund(order, plan.amount, plan.full);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.error === "PAYMENTS_NOT_CONFIGURED" ? 503 : 502 });
  }

  const recorded = await recordRefund(order.id, plan.amount);
  if (!recorded.ok) {
    // The provider HAS refunded but the ledger refused — surface this
    // loudly (security log + 500) so it is reconciled by a human; the
    // reconcile-orders job will also converge the ledger from Stripe.
    await recordSecurityEvent({
      kind: "refund_ledger_mismatch", actor: auth.actor.actor,
      detail: { orderId: order.id, providerRefundId: outcome.providerRefundId, reason: recorded.reason },
    }).catch(() => undefined);
    return NextResponse.json({ error: "LEDGER_RECORD_FAILED", providerRefundId: outcome.providerRefundId }, { status: 500 });
  }

  await recordAudit({
    actor: auth.actor, action: recorded.full ? "office.order_refund_full" : "office.order_refund_partial",
    target: order.id,
    detail: { amountUSD: recorded.amount, providerRefundId: outcome.providerRefundId, provider: order.provider },
  });
  return NextResponse.json({
    ok: true, full: recorded.full, amountUSD: recorded.amount,
    providerRefundId: outcome.providerRefundId, order: recorded.order,
  });
}
