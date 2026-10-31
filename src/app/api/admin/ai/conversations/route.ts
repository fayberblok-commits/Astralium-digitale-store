/**
 * AI conversation log (Phase 5 upgrade) — owner quality review.
 *
 * GET ?scope=customer|owner&limit=N — recent conversations with their
 * messages, the responding employee, injection-suspicion flags and
 * escalation links. Customer conversations contain visitor text: this
 * is the owner's own support-quality view, gated behind the
 * "support_ops" permission like tickets.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import { httpErrorResponse } from "../../../../../lib/http";
import { listConversations } from "../../../../../lib/ai/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "support_ops");
  if ("error" in auth) return auth.error;
  try {
    const url = new URL(req.url);
    const scopeParam = url.searchParams.get("scope");
    const scope = scopeParam === "customer" || scopeParam === "owner" ? scopeParam : undefined;
    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 20;
    return NextResponse.json({ conversations: await listConversations({ scope, limit }) });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
