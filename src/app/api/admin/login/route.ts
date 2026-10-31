import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, createAdminSession, checkAdminPassword, adminConfigured } from "../../../../lib/admin";
import { getFlag } from "../../../../lib/flags";
import { createTeamSession, decryptSecret, hashBackupCode, loginTeamUser } from "../../../../lib/team";
import { verifyTotp } from "../../../../lib/totp";
import { rateLimiters, tooManyRequests } from "../../../../lib/ratelimit";
import {
  deviceFingerprint, guardLocked, guardRecordFailure, guardRecordSuccess,
  loadSecurityState, noteDevice, saveSecurityState,
} from "../../../../lib/security-state";
import { recordSecurityEvent } from "../../../../lib/security-log";
import { getClientIp, httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

function sessionResponse(token: string | null, extra: Record<string, unknown> = {}): NextResponse {
  const res = NextResponse.json({ ok: true, ...extra });
  res.cookies.set(ADMIN_COOKIE, token ?? "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // 8-hour admin sessions (absolute cap; idle timeout enforced server-side)
  });
  return res;
}

function fail(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/**
 * Admin login — Phase 1 upgrade hardening (§1, §4, §13):
 *  - unified readJsonBody: malformed JSON is a 400, never a 500;
 *  - rate limits per IP AND per account (independent budgets);
 *  - durable per-account lockout after repeated failures (persisted in
 *    the security state — a restart is not a bypass);
 *  - BOTH paths support TOTP: team accounts (Phase 6) and the bootstrap
 *    owner (Phase 1: enrollment lives in the security state; codes are
 *    replay-guarded and backup codes are single-use);
 *  - privileged accounts without TOTP enrolled receive a "setup"-scope
 *    session that can only reach the enrollment endpoints (always for
 *    team owner/admin; for the bootstrap owner when
 *    ADMIN_TOTP_REQUIRED=1 — otherwise a full session plus a
 *    `totpEnrollmentRequired` flag the UI surfaces);
 *  - a successful login from an unseen device fingerprint raises a
 *    security event + owner alert;
 *  - every failure/success is written to the security log (no secrets).
 */
export async function POST(req: NextRequest) {
  if (!adminConfigured()) {
    return fail(503, "ADMIN_NOT_CONFIGURED");
  }
  let body: { password?: string; email?: string; code?: string };
  try {
    body = await readJsonBody(req, { maxBytes: 8 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.password) {
    return fail(401, "INVALID_PASSWORD");
  }

  const ip = getClientIp(req);
  const ipCheck = rateLimiters.adminLoginIp.check(`ip:${ip}`);
  if (!ipCheck.allowed) return tooManyRequests(ipCheck);

  const accountKey = body.email ? body.email.trim().toLowerCase() : "bootstrap-owner";
  const acctCheck = rateLimiters.adminLoginAccount.check(`acct:${accountKey}`);
  if (!acctCheck.allowed) return tooManyRequests(acctCheck);

  const state = await loadSecurityState();
  if (guardLocked(state, accountKey, Date.now())) {
    return fail(429, "LOGIN_LOCKED");
  }

  const onFailure = async (error: string, status = 401): Promise<NextResponse> => {
    const fresh = await loadSecurityState();
    const tripped = guardRecordFailure(fresh, accountKey, Date.now());
    await saveSecurityState(fresh);
    await recordSecurityEvent({ kind: "login_failed", actor: accountKey, detail: { via: body.email ? "team" : "bootstrap" } });
    if (tripped) {
      await recordSecurityEvent({ kind: "login_locked", actor: accountKey, detail: { lockoutMinutes: 15 } });
    }
    return fail(status, error);
  };

  const onSuccess = async (actorKey: string): Promise<void> => {
    const fresh = await loadSecurityState();
    guardRecordSuccess(fresh, actorKey);
    const fp = deviceFingerprint(req.headers.get("user-agent") ?? "", ip);
    const isNew = noteDevice(fresh, actorKey, fp);
    const hadDevices = (fresh.knownDevices[actorKey] ?? []).length > 1;
    await saveSecurityState(fresh);
    if (isNew && hadDevices) {
      await recordSecurityEvent({ kind: "login_success_new_device", actor: actorKey, detail: { via: body.email ? "team" : "bootstrap" } });
    }
  };

  // ── Team account path ──────────────────────────────────────────────────────
  if (body.email) {
    if (!(await getFlag("team_access"))) {
      return fail(403, "TEAM_ACCESS_DISABLED");
    }
    const result = await loginTeamUser(body.email, body.password, body.code);
    if (!result.ok) {
      return onFailure(result.error);
    }
    await onSuccess(accountKey);
    const scope = result.totpSetupRequired ? "setup" : "full";
    return sessionResponse(
      createTeamSession(result.user, { epoch: state.sessionEpoch, scope }),
      { role: result.user.role, ...(result.totpSetupRequired ? { totpEnrollmentRequired: true } : {}) },
    );
  }

  // ── Bootstrap owner path ───────────────────────────────────────────────────
  if (!checkAdminPassword(body.password)) {
    return onFailure("INVALID_PASSWORD");
  }

  // Bootstrap TOTP (Phase 1): enforced whenever the owner has enrolled.
  const ownerTotp = state.ownerTotp;
  if (ownerTotp?.enabled) {
    if (!body.code) return fail(401, "TOTP_REQUIRED");
    let ok = false;
    const secret = decryptSecret(ownerTotp.secretCipher);
    if (secret) {
      const verdict = verifyTotp(secret, body.code, { lastUsedStep: ownerTotp.lastStep });
      if (verdict.ok && verdict.step != null) {
        ownerTotp.lastStep = verdict.step; // replay guard persisted before the session is issued
        ok = true;
      }
    }
    if (!ok) {
      const hash = hashBackupCode(body.code);
      const idx = ownerTotp.backupCodeHashes.indexOf(hash);
      if (idx >= 0) {
        ownerTotp.backupCodeHashes.splice(idx, 1); // single-use
        ok = true;
      }
    }
    if (!ok) return onFailure("TOTP_INVALID");
    await saveSecurityState(state);
  }

  await onSuccess(accountKey);
  const totpRequired = process.env.ADMIN_TOTP_REQUIRED === "1";
  const needsSetup = !ownerTotp?.enabled;
  const scope = needsSetup && totpRequired ? "setup" : "full";
  return sessionResponse(
    createAdminSession({ epoch: state.sessionEpoch, scope }),
    { role: "owner", ...(needsSetup ? { totpEnrollmentRequired: true } : {}) },
  );
}
