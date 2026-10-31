/**
 * AI action decisions (Phase 5 upgrade) — where the OWNER's click is
 * the only thing that turns an AI preview into a change.
 *
 * GET: recent actions (previews, approvals pending, applied, undone).
 * POST { actionId, decision: "apply" | "approve" | "reject" | "undo" }
 * — the actions engine re-checks the clicking actor's permission for
 * the specific tool (same permission as the equivalent manual route)
 * and audit-logs every transition as executed-by-employee on the
 * owner's order.
 * Gate: admin session with "settings" (the AI panel's own gate).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";
import { applyAction, decideAction, listActions, undoAction } from "../../../../../lib/ai/actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  try {
    return NextResponse.json({ actions: await listActions(60) });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  let body: { actionId?: string; decision?: string };
  try {
    body = await readJsonBody(req, { maxBytes: 16 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  try {
    if (typeof body.actionId !== "string" || !body.actionId) {
      return NextResponse.json({ error: "ACTION_ID_REQUIRED" }, { status: 400 });
    }
    let result;
    if (body.decision === "apply") result = await applyAction(body.actionId, actor);
    else if (body.decision === "approve") result = await decideAction(body.actionId, actor, "approve");
    else if (body.decision === "reject") result = await decideAction(body.actionId, actor, "reject");
    else if (body.decision === "undo") result = await undoAction(body.actionId, actor);
    else return NextResponse.json({ error: "DECISION_INVALID" }, { status: 400 });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, action: result.action });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
