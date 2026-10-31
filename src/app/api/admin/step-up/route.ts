import { NextRequest, NextResponse } from "next/server";
import { STEPUP_COOKIE, checkAdminPassword, createStepUpToken } from "../../../../lib/admin";
import { findUserById, loginTeamUser, requireAdmin } from "../../../../lib/team";
import { loadSecurityState } from "../../../../lib/security-state";
import { recordSecurityEvent } from "../../../../lib/security-log";
import { decryptSecret } from "../../../../lib/team";
import { verifyTotp } from "../../../../lib/totp";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Step-up re-authentication (Phase 1 upgrade, §4). The signed-in admin
 * re-proves their credential (password + TOTP when enrolled) and
 * receives a short-lived (5 min), actor-bound step-up cookie. Sensitive
 * routes (team management, owner-TOTP changes, terminate-all, …) call
 * requireStepUp() and refuse without it — a hijacked session cookie
 * alone cannot perform financial/administrative actions.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "self");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;

  let body: { password?: string; code?: string };
  try {
    body = await readJsonBody(req, { maxBytes: 8 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.password) {
    return NextResponse.json({ error: "PASSWORD_REQUIRED" }, { status: 400 });
  }

  let ok = false;
  if (actor.via === "password") {
    ok = checkAdminPassword(body.password);
    if (ok) {
      const state = await loadSecurityState();
      if (state.ownerTotp?.enabled) {
        if (!body.code) return NextResponse.json({ error: "TOTP_REQUIRED" }, { status: 401 });
        const secret = decryptSecret(state.ownerTotp.secretCipher);
        const verdict = secret ? verifyTotp(secret, body.code, { lastUsedStep: null }) : { ok: false };
        ok = verdict.ok;
      }
    }
  } else if (actor.userId) {
    const user = await findUserById(actor.userId);
    if (user) {
      // Reuse the login verifier (password + TOTP/backup code, replay-safe).
      const result = await loginTeamUser(user.email, body.password, body.code);
      ok = result.ok;
      if (!result.ok && result.error === "TOTP_REQUIRED") {
        return NextResponse.json({ error: "TOTP_REQUIRED" }, { status: 401 });
      }
    }
  }
  if (!ok) {
    await recordSecurityEvent({ kind: "login_failed", actor: actor.actor, detail: { stepUp: true } });
    return NextResponse.json({ error: "STEP_UP_FAILED" }, { status: 401 });
  }

  const token = createStepUpToken(actor.actor);
  if (!token) return NextResponse.json({ error: "STEP_UP_UNAVAILABLE" }, { status: 503 });
  await recordSecurityEvent({ kind: "step_up_granted", actor: actor.actor, detail: {} });
  const res = NextResponse.json({ ok: true, expiresInSeconds: 300 });
  res.cookies.set(STEPUP_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/admin",
    maxAge: 300,
  });
  return res;
}
