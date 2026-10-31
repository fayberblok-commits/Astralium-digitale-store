import { NextRequest, NextResponse } from "next/server";
import {
  confirmTotpEnrollment, createUser, deleteUser, disableTotp, isRole, listUsers,
  publicUser, recordAudit, requireAdmin, requireStepUp, setUserRole, startTotpEnrollment,
} from "../../../../lib/team";
import { getFlag } from "../../../../lib/flags";
import { httpErrorResponse, readJsonBody } from "../../../../lib/http";

export const runtime = "nodejs";

/**
 * Team administration (Phase 6, feature 29).
 *  - Listing users needs the "team" permission (owner only).
 *  - Creating users / changing roles / deleting: "team" (owner only).
 *  - TOTP enrollment (start/confirm/disable): the account holder
 *    themselves (signed in as that user) OR a "team" permission holder.
 *    start/confirm return the secret / backup codes exactly once.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "team");
  if ("error" in auth) return auth.error;
  const users = await listUsers();
  return NextResponse.json({ users: users.map(publicUser), enabled: await getFlag("team_access") });
}

export async function POST(req: NextRequest) {
  let body: { action?: string; id?: string; email?: string; password?: string; role?: string; code?: string } | null;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return httpErrorResponse(err);
  }
  if (!body?.action) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  // Self-service enrollment actions: the target must be the caller, or
  // the caller holds the "team" permission.
  if (body.action === "enrollStart" || body.action === "enrollConfirm" || body.action === "disableTotp") {
    // "self" permission: also reachable by setup-scope sessions (TOTP
    // not yet enrolled) — enrollment is precisely what they must do.
    const selfAuth = await requireAdmin(req, "self");
    if ("error" in selfAuth) return selfAuth.error;
    const actor = selfAuth.actor;
    const targetId = body.id ?? actor.userId ?? "";
    const isSelf = actor.userId != null && actor.userId === targetId;
    const isTeamManager = actor.role === "owner";
    if (!isSelf && !isTeamManager) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    if (body.action === "enrollStart") {
      const r = await startTotpEnrollment(targetId);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      await recordAudit({ actor, action: "team.totp.enrollStart", target: targetId });
      // secret + otpauth URI returned ONCE for authenticator setup.
      return NextResponse.json({ ok: true, secret: r.secret, uri: r.uri });
    }
    if (body.action === "enrollConfirm") {
      if (!body.code) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
      const r = await confirmTotpEnrollment(targetId, body.code);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      await recordAudit({ actor, action: "team.totp.enabled", target: targetId });
      // backupCodes returned ONCE — only hashes are stored.
      return NextResponse.json({ ok: true, backupCodes: r.backupCodes });
    }
    const r = await disableTotp(targetId);
    if (!r.ok) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    await recordAudit({ actor, action: "team.totp.disabled", target: targetId });
    return NextResponse.json({ ok: true });
  }

  // Everything below manages OTHER accounts: "team" permission (owner).
  const auth = await requireAdmin(req, "team");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;

  // Step-up (Phase 1 upgrade, §4): creating accounts, changing roles and
  // deleting accounts are sensitive — a fresh re-auth (password + TOTP,
  // ≤5 min old, via POST /api/admin/step-up) is required.
  const step = await requireStepUp(req, actor);
  if ("error" in step) return step.error;

  if (body.action === "create") {
    if (!body.email || !body.password || !isRole(body.role)) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const r = await createUser({ email: body.email, password: body.password, role: body.role });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await recordAudit({ actor, action: "team.user.create", target: r.user.email, detail: { role: r.user.role } });
    return NextResponse.json({ ok: true, user: publicUser(r.user) });
  }
  if (body.action === "setRole") {
    if (!body.id || !isRole(body.role)) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const r = await setUserRole(body.id, body.role);
    if (!r.ok) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    await recordAudit({ actor, action: "team.user.setRole", target: body.id, detail: { role: body.role } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "delete") {
    if (!body.id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    if (actor.userId === body.id) {
      return NextResponse.json({ error: "CANNOT_DELETE_SELF" }, { status: 400 });
    }
    const r = await deleteUser(body.id);
    if (!r.ok) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    await recordAudit({ actor, action: "team.user.delete", target: body.id });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
