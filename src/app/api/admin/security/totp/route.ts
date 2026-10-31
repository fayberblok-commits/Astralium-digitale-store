import { NextRequest, NextResponse } from "next/server";
import { encryptSecret, decryptSecret, generateBackupCodes, hashBackupCode, requireAdmin, requireStepUp } from "../../../../../lib/team";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../../../../lib/totp";
import { loadSecurityState, saveSecurityState } from "../../../../../lib/security-state";
import { recordSecurityEvent } from "../../../../../lib/security-log";
import { httpErrorResponse, readJsonBody } from "../../../../../lib/http";

export const runtime = "nodejs";

/**
 * Bootstrap-owner TOTP management (Phase 1 upgrade, §4). Team accounts
 * enroll through /api/admin/team; the ADMIN_PASSWORD owner has no DB
 * row, so its enrollment lives in the durable security state (secret
 * AES-256-GCM encrypted via team.ts, backup codes hash-only).
 *
 *  { action: "start" }   → returns the secret + otpauth URI ONCE.
 *  { action: "confirm", code } → enables TOTP, returns backup codes ONCE.
 *  { action: "disable" } → requires step-up; clears the enrollment.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "self");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  if (actor.via !== "password") {
    return NextResponse.json({ error: "USE_TEAM_ENROLLMENT" }, { status: 400 });
  }

  let body: { action?: string; code?: string };
  try {
    body = await readJsonBody(req, { maxBytes: 8 * 1024 });
  } catch (err) {
    return httpErrorResponse(err);
  }

  const state = await loadSecurityState();

  if (body.action === "start") {
    // Re-enrollment over an ACTIVE enrollment is a sensitive change.
    if (state.ownerTotp?.enabled) {
      const step = await requireStepUp(req, actor);
      if ("error" in step) return step.error;
    }
    const secret = generateTotpSecret();
    let cipher: string;
    try {
      cipher = encryptSecret(secret);
    } catch {
      return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 503 });
    }
    state.ownerTotp = {
      secretCipher: cipher,
      enabled: false,
      lastStep: null,
      backupCodeHashes: state.ownerTotp?.enabled ? state.ownerTotp.backupCodeHashes : [],
    };
    await saveSecurityState(state);
    return NextResponse.json({
      ok: true,
      secret,
      uri: otpauthUri({ issuer: "Astralium Control", account: "bootstrap-owner", secret }),
    });
  }

  if (body.action === "confirm") {
    if (!state.ownerTotp || !body.code) {
      return NextResponse.json({ error: "ENROLLMENT_NOT_STARTED" }, { status: 400 });
    }
    const secret = decryptSecret(state.ownerTotp.secretCipher);
    if (!secret) return NextResponse.json({ error: "SECRET_UNREADABLE" }, { status: 500 });
    const verdict = verifyTotp(secret, body.code, { lastUsedStep: null });
    if (!verdict.ok) return NextResponse.json({ error: "TOTP_INVALID" }, { status: 400 });
    const backupCodes = generateBackupCodes(8);
    state.ownerTotp.enabled = true;
    state.ownerTotp.lastStep = verdict.step;
    state.ownerTotp.backupCodeHashes = backupCodes.map(hashBackupCode);
    await saveSecurityState(state);
    await recordSecurityEvent({ kind: "totp_enrolled", actor: actor.actor, detail: { via: "bootstrap" } });
    return NextResponse.json({ ok: true, backupCodes });
  }

  if (body.action === "disable") {
    const step = await requireStepUp(req, actor);
    if ("error" in step) return step.error;
    state.ownerTotp = null;
    await saveSecurityState(state);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
