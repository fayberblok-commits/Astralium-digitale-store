import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "../../../../../lib/admin";
import { getDb } from "../../../../../lib/db";
import { deliverOrder } from "../../../../../services/delivery";
import type { DeliveryChannelKey } from "../../../../../services/delivery/types";

export const runtime = "nodejs";

const CHANNEL_SET = new Set(["email", "whatsapp", "messenger", "instagram"]);

/**
 * Manual resend from the admin delivery log. The order's items/recipient
 * are resolved from the database Order row when one exists; otherwise the
 * caller must supply email + productIds explicitly (this release's orders
 * are fulfilled via provider webhooks, so a DB row is not guaranteed) —
 * when neither is available we say so instead of pretending to resend.
 */
export async function POST(req: NextRequest) {
  if (!isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    orderId?: string;
    channel?: string;
    email?: string;
    productIds?: string[];
  } | null;
  if (!body?.orderId || !body.channel || !CHANNEL_SET.has(body.channel)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const channel = body.channel as DeliveryChannelKey;

  let email = body.email ?? null;
  let productIds = body.productIds ?? [];
  if (productIds.length === 0) {
    try {
      const db = await getDb();
      if (db) {
        const order = await db.order.findUnique({
          where: { id: body.orderId },
          include: { items: true },
        });
        if (order) {
          email = email ?? order.email;
          productIds = order.items.map((i) => i.productId);
        }
      }
    } catch {
      // handled by the check below
    }
  }
  if (productIds.length === 0) {
    return NextResponse.json(
      { error: "ORDER_ITEMS_NOT_FOUND", detail: "No database order with items for this id; pass email + productIds to resend." },
      { status: 422 },
    );
  }
  const outcome = await deliverOrder(
    { orderId: body.orderId, email, productIds },
    channel,
  );
  return NextResponse.json({
    ok: outcome.deliveredVia !== null,
    deliveredVia: outcome.deliveredVia,
    fellBack: outcome.fellBack,
    alreadyDelivered: outcome.alreadyDelivered,
    reason: outcome.reason ?? null,
  });
}
