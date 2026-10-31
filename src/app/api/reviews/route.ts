import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../lib/flags";
import { getStorefrontProductById } from "../../../lib/catalog";
import { addReview, aggregateReviews, listReviews, validateReviewInput } from "../../../lib/reviews";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../lib/ratelimit";
import { captchaGate } from "../../../lib/captcha";

export const runtime = "nodejs";

/** Approved reviews + aggregate for one product (public). */
export async function GET(req: NextRequest) {
  if (!(await getFlag("reviews"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const productId = req.nextUrl.searchParams.get("productId");
  if (!productId || !(await getStorefrontProductById(productId))) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  const approved = await listReviews(productId, "approved");
  return NextResponse.json({
    aggregate: aggregateReviews(approved),
    reviews: approved.map((r) => ({
      id: r.id, rating: r.rating, title: r.title, body: r.body,
      verified: r.verified, createdAt: r.createdAt,
    })),
  });
}

/**
 * Submit a review. ALWAYS lands as "pending" — verified purchases
 * included; a moderator approves before anything is public. Without a
 * DB, purchase verification is unavailable (verified=false) and the
 * response says so via `verification: "unavailable"`.
 */
export async function POST(req: NextRequest) {
  if (!(await getFlag("reviews"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  let body: {
    productId?: string; orderId?: string; email?: string;
    rating?: unknown; title?: string; body?: unknown;
  } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  const ip = getClientIp(req);
  const ipCheck = rateLimiters.reviewIp.check(`ip:${ip}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);
  if (!body?.productId || !(await getStorefrontProductById(body.productId))) {
    return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
  }
  const captchaBlock = await captchaGate((body as { captchaToken?: string }).captchaToken, ip);
  if (captchaBlock) return captchaBlock;
  const email = (body.email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }
  const valid = validateReviewInput({ rating: body.rating, body: body.body });
  if (!valid.ok) {
    return NextResponse.json({ error: valid.reason }, { status: 400 });
  }
  const { persisted, review } = await addReview({
    productId: body.productId,
    orderId: body.orderId?.slice(0, 60),
    email,
    rating: valid.rating,
    title: body.title,
    body: valid.body,
  });
  return NextResponse.json({
    ok: true,
    persisted,
    status: review.status,
    verified: review.verified,
    verification: review.verified ? "order-matched" : "unavailable",
  });
}
