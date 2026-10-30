import { NextRequest, NextResponse } from "next/server";
import { applyCoupon } from "../../../../lib/coupons";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    code?: string;
    subtotalUSD?: number;
    isFirstOrder?: boolean;
    country?: string;
  } | null;
  if (!body?.code || typeof body.subtotalUSD !== "number") {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }
  const country = body.country ?? req.headers.get("cf-ipcountry") ?? undefined;
  const result = applyCoupon(body.code, body.subtotalUSD, {
    isFirstOrder: body.isFirstOrder ?? true,
    country,
  });
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason });
  return NextResponse.json({
    ok: true,
    code: result.coupon.code,
    discountUSD: result.discountUSD,
  });
}
