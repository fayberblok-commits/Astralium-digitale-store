import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminSessionToken, checkAdminPassword, adminConfigured } from "../../../../lib/admin";
import { getFlag } from "../../../../lib/flags";
import { createTeamSession, loginTeamUser } from "../../../../lib/team";

export const runtime = "nodejs";

function sessionResponse(token: string | null, extra: Record<string, unknown> = {}): NextResponse {
  const res = NextResponse.json({ ok: true, ...extra });
  res.cookies.set(ADMIN_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8-hour admin sessions
  });
  return res;
}

/**
 * Admin login. Two paths, both issuing the same session cookie:
 *  - Bootstrap owner: { password } matching ADMIN_PASSWORD (unchanged
 *    behaviour from earlier phases; the session acts as role "owner").
 *  - Team account (Phase 6, feature 29): { email, password, code? } —
 *    when the account has TOTP enabled, a valid authenticator code (or
 *    a single-use backup code) is required; the first attempt without
 *    one returns 401 TOTP_REQUIRED so the form can reveal the field.
 */
export async function POST(req: NextRequest) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as
    | { password?: string; email?: string; code?: string }
    | null;
  if (!body?.password) {
    return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 401 });
  }

  if (body.email) {
    if (!(await getFlag("team_access"))) {
      return NextResponse.json({ error: "TEAM_ACCESS_DISABLED" }, { status: 403 });
    }
    const result = await loginTeamUser(body.email, body.password, body.code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }
    return sessionResponse(createTeamSession(result.user), { role: result.user.role });
  }

  if (!checkAdminPassword(body.password)) {
    return NextResponse.json({ error: "INVALID_PASSWORD" }, { status: 401 });
  }
  return sessionResponse(adminSessionToken(), { role: "owner" });
}
