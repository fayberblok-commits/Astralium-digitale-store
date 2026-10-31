import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin, type Permission } from "../../../../lib/team";
import {
  addToBlacklist, getFraudConfig, holdBuyerEmail, listBlacklist, listHolds,
  removeFromBlacklist, resolveHold, sanitizeFraudConfig, setFraudConfig,
} from "../../../../lib/fraud";
import { getDb } from "../../../../lib/db";
import { deliverOrder } from "../../../../services/delivery";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

// Phase 6 (feature 29): role-based guard — GET needs "read", mutations
// need this route's permission (see the matrix in lib/team.ts). The
// ADMIN_PASSWORD bootstrap session acts as owner and passes everything.
async function guard(req: NextRequest, permission: Permission): Promise<Response | null> {
  const res = await requireAdmin(req, permission);
  return "error" in res ? res.error : null;
}

/**
 * Fraud-shield administration (Phase 5, feature 19): the held-order
 * review queue (approve = release + re-deliver when possible, reject =
 * owner refunds manually in the provider dashboard), the hash-only
 * email blacklist, and the hold threshold. Hold rows show the email
 * HASH (first chars) — the raw address is shown only when it can be
 * decrypted from the hold's own ciphertext for the release action.
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req, "read");
  if (denied) return denied;
  const [holds, blacklist, config] = await Promise.all([listHolds(), listBlacklist(), getFraudConfig()]);
  return NextResponse.json({
    config,
    holds: holds.map((h) => ({
      id: h.id, orderId: h.orderId, emailHashPrefix: h.emailHash.slice(0, 10),
      score: h.score, reasons: h.reasons, status: h.status,
      createdAt: h.createdAt, resolvedAt: h.resolvedAt,
      emailable: Boolean(holdBuyerEmail(h)),
    })),
    blacklist: blacklist.map((b) => ({
      id: b.id, emailHashPrefix: b.emailHash.slice(0, 10), reason: b.reason, createdAt: b.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "commerce");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  let body: { action?: string; id?: string; email?: string; reason?: string; threshold?: number } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.action) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  if (body.action === "release" || body.action === "reject") {
    if (!body.id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const resolved = await resolveHold(body.id, body.action === "release" ? "released" : "rejected");
    if (!resolved) return NextResponse.json({ error: "HOLD_NOT_FOUND_OR_RESOLVED" }, { status: 404 });
    await recordAudit({ actor, action: `fraud.hold.${body.action}`, target: resolved.orderId, detail: { holdId: body.id } });
    let redelivered = false;
    if (body.action === "release") {
      // Re-issue delivery on the email channel when we know both the
      // buyer (hold ciphertext) and the items (persisted order). The
      // download gate opens either way — the buyer's success-page links
      // work again the moment the hold is released.
      const email = holdBuyerEmail(resolved);
      const productIds = await orderProductIds(resolved.orderId);
      if (email && productIds.length > 0) {
        const outcome = await deliverOrder({ orderId: resolved.orderId, email, productIds }, "email");
        redelivered = outcome.deliveredVia !== null || outcome.alreadyDelivered;
      }
    }
    return NextResponse.json({ ok: true, status: resolved.status, redelivered });
  }
  if (body.action === "blacklist-add") {
    if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    const { persisted, record } = await addToBlacklist(body.email, body.reason ?? "");
    await recordAudit({ actor, action: "fraud.blacklist.add", target: record.id, detail: { persisted } });
    return NextResponse.json({ ok: true, persisted, id: record.id });
  }
  if (body.action === "blacklist-remove") {
    if (!body.id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const result = await removeFromBlacklist(body.id);
    if (!result.ok) return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
    await recordAudit({ actor, action: "fraud.blacklist.remove", target: body.id });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "config") {
    const { persisted, value } = await setFraudConfig(sanitizeFraudConfig({ threshold: body.threshold }));
    return NextResponse.json({ ok: true, persisted, config: value });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}

async function orderProductIds(orderId: string): Promise<string[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const order = await db.order.findFirst({
      where: { OR: [{ id: orderId }, { providerRef: orderId }] },
      include: { items: true },
    });
    return order ? order.items.map((i) => i.productId) : [];
  } catch {
    return [];
  }
}
