/**
 * Owner-staff chat (Phase 5 upgrade) — the Manager's Office window.
 *
 * POST { message, employeeId?, history? } → one gateway turn. The
 * model can only PROPOSE: write tools return as action previews in
 * the response (`actions`), applied later via the actions route at
 * the owner's explicit click. Refusals are returned verbatim in
 * `refusals` — never hidden.
 * Gates: admin session with "settings" permission; feature flag
 * ai_owner_staff ON; per-actor rate limit; gateway hard stops
 * (emergency stop / cost cap / unconfigured) surface as honest codes.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/team";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";
import { rateLimiters, tooManyRequests } from "../../../../../lib/ratelimit";
import { getFlag } from "../../../../../lib/flags";
import { runOwnerTurn } from "../../../../../lib/ai/gateway";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  if (!(await getFlag("ai_owner_staff"))) {
    return NextResponse.json(
      { error: "FLAG_OFF", message: "The owner AI staff is switched off. Enable the ai_owner_staff flag in the office Design & features panel." },
      { status: 403 },
    );
  }
  const limit = rateLimiters.aiOwnerActor.check(`actor:${actor.actor}`);
  if (!limit.allowed) return tooManyRequests(limit);
  let body: {
    message?: string;
    employeeId?: string;
    history?: { role: "user" | "assistant"; text: string }[];
  };
  try {
    body = await readJsonBody(req, { maxBytes: 64 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  try {
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "MESSAGE_REQUIRED" }, { status: 400 });
    if (message.length > 4000) return NextResponse.json({ error: "MESSAGE_TOO_LONG" }, { status: 413 });
    const history = Array.isArray(body.history)
      ? body.history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.text === "string").slice(-10)
      : undefined;
    const result = await runOwnerTurn({
      actor, message,
      ...(typeof body.employeeId === "string" && body.employeeId ? { employeeId: body.employeeId } : {}),
      ...(history ? { history } : {}),
    });
    return NextResponse.json(result);
  } catch (err) {
    return httpErrorResponse(err);
  }
}
