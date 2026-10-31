import { NextRequest, NextResponse } from "next/server";
import { applyCouponIn } from "../../../../lib/coupons";
import { getCoupons } from "../../../../lib/coupons-store";
import { getClientCountry, getClientIp, httpErrorResponse, readJsonBody } from "../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // §1: coupon guessing is rate-limited per IP.
  const ipCheck = rateLimiters.couponIp.check(`ip:${getClientIp(req)}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  let body: {
    code?: string;
    subtotalUSD?: number;
    isFirstOrder?: boolean;
    country?: string;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.code || typeof body.subtotalUSD !== "number") {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }
  const country = body.country ?? getClientCountry(req) ?? undefined;
  // Phase 4 upgrade: validate against the office-managed coupon list.
  const result = applyCouponIn(await getCoupons(), body.code, body.subtotalUSD, {
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
