import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin } from "../../../../../lib/team";
import { sanitizeCoupon, type Coupon } from "../../../../../lib/coupons";
import { getCoupons, setCoupons } from "../../../../../lib/coupons-store";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Manager's Office — coupons & discounts (Phase 4 upgrade, item 6).
 *
 * The coupon list is office-managed data now (lib/coupons-store.ts):
 * checkout and the validation route evaluate against this list.
 * Mutations need `content` (owner/manager/admin/marketer) and are
 * audit-logged; the pure engine in lib/coupons.ts does the math.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "read");
  if ("error" in auth) return auth.error;
  return NextResponse.json({ coupons: await getCoupons() });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "content");
  if ("error" in auth) return auth.error;
  let body: { action?: string; coupon?: unknown; code?: string; active?: boolean } | null;
  try {
    body = await readJsonBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  const list = await getCoupons();

  if (body?.action === "upsert") {
    const coupon = sanitizeCoupon(body.coupon);
    if (!coupon) return NextResponse.json({ error: "INVALID_COUPON" }, { status: 400 });
    const next: Coupon[] = [...list.filter((c) => c.code !== coupon.code), coupon];
    const { value } = await setCoupons(next);
    await recordAudit({ actor: auth.actor, action: "office.coupon_upsert", target: coupon.code, detail: { type: coupon.type, value: coupon.value, active: coupon.active } });
    return NextResponse.json({ ok: true, coupons: value });
  }
  if (body?.action === "toggle" && typeof body.code === "string") {
    const code = body.code.toUpperCase();
    const next = list.map((c) => (c.code === code ? { ...c, active: body.active === true } : c));
    const { value } = await setCoupons(next);
    await recordAudit({ actor: auth.actor, action: "office.coupon_toggle", target: code, detail: { active: body.active === true } });
    return NextResponse.json({ ok: true, coupons: value });
  }
  if (body?.action === "delete" && typeof body.code === "string") {
    const code = body.code.toUpperCase();
    const { value } = await setCoupons(list.filter((c) => c.code !== code));
    await recordAudit({ actor: auth.actor, action: "office.coupon_delete", target: code });
    return NextResponse.json({ ok: true, coupons: value });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
