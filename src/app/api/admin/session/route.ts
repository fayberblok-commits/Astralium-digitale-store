import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, createAdminSession } from "../../../../lib/admin";
import { createTeamSession, findUserById, requireAdmin } from "../../../../lib/team";
import { currentSessionEpoch } from "../../../../lib/security-state";

export const runtime = "nodejs";

function setSessionCookie(res: NextResponse, token: string | null): void {
  res.cookies.set(ADMIN_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

/**
 * Session lifecycle (Phase 1 upgrade, §4).
 *  POST            — rotate/refresh: a valid session exchanges its token
 *                    for a fresh one (new iat — this is what makes the
 *                    idle timeout survivable for an active admin, and it
 *                    is the rotation-on-activity mechanism).
 *  POST /terminate — no; see ./terminate-all.
 *  DELETE          — log out (clears the cookie).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "self");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  const epoch = await currentSessionEpoch();

  let token: string | null = null;
  if (actor.via === "password") {
    token = createAdminSession({ epoch, scope: actor.scope });
  } else if (actor.userId) {
    const user = await findUserById(actor.userId);
    if (user) token = createTeamSession(user, { epoch, scope: actor.scope });
  }
  if (!token) return NextResponse.json({ error: "SESSION_ISSUE_FAILED" }, { status: 500 });
  const res = NextResponse.json({ ok: true, rotated: true });
  setSessionCookie(res, token);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
