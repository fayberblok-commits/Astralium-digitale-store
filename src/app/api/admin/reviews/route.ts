import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin, type Permission } from "../../../../lib/team";
import { listPendingReviews, moderateReview } from "../../../../lib/reviews";

export const runtime = "nodejs";

// Phase 6 (feature 29): role-based guard — GET needs "read", mutations
// need this route's permission (see the matrix in lib/team.ts). The
// ADMIN_PASSWORD bootstrap session acts as owner and passes everything.
async function guard(req: NextRequest, permission: Permission): Promise<Response | null> {
  const res = await requireAdmin(req, permission);
  return "error" in res ? res.error : null;
}

/** Pending review queue for moderation. */
export async function GET(req: NextRequest) {
  const denied = await guard(req, "read");
  if (denied) return denied;
  const pending = await listPendingReviews();
  return NextResponse.json({
    reviews: pending.map((r) => ({
      id: r.id, productId: r.productId, rating: r.rating, title: r.title,
      body: r.body, verified: r.verified, createdAt: r.createdAt,
    })),
  });
}

/** Approve or reject a pending review. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "moderate");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => null)) as { id?: string; action?: string } | null;
  if (!body?.id || (body.action !== "approve" && body.action !== "reject")) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const result = await moderateReview(body.id, body.action === "approve" ? "approved" : "rejected");
  if (!result.ok) return NextResponse.json({ error: "REVIEW_NOT_FOUND" }, { status: 404 });
  await recordAudit({ actor: auth.actor, action: `review.${body.action}`, target: body.id });
  return NextResponse.json({ ok: true, persisted: result.persisted });
}
