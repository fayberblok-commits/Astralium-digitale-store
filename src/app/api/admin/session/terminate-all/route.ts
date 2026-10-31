import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, createAdminSession } from "../../../../../lib/admin";
import { createTeamSession, findUserById, requireAdmin, requireStepUp } from "../../../../../lib/team";
import { terminateAllSessions } from "../../../../../lib/security-state";
import { recordSecurityEvent } from "../../../../../lib/security-log";

export const runtime = "nodejs";

/**
 * Terminate ALL admin sessions (Phase 1 upgrade, §4): bumps the durable
 * session epoch so every outstanding token (bootstrap + team, including
 * possibly-stolen ones) stops validating immediately. Requires the
 * "settings" permission AND a fresh step-up. The caller receives a new
 * session minted under the new epoch — everyone else is logged out.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "settings");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  const step = await requireStepUp(req, actor);
  if ("error" in step) return step.error;

  const epoch = await terminateAllSessions();
  await recordSecurityEvent({ kind: "sessions_terminated", actor: actor.actor, detail: { epoch } });

  let token: string | null = null;
  if (actor.via === "password") {
    token = createAdminSession({ epoch, scope: actor.scope });
  } else if (actor.userId) {
    const user = await findUserById(actor.userId);
    if (user) token = createTeamSession(user, { epoch, scope: actor.scope });
  }
  const res = NextResponse.json({ ok: true, epoch });
  if (token) {
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  }
  return res;
}
