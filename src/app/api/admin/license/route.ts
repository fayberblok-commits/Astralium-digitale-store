import { NextRequest, NextResponse } from "next/server";
import { recordAudit, requireAdmin, type Permission } from "../../../../lib/team";
import {
  getLicenseConfig, listLicenseKeys, maskLicenseKey, revokeLicenseKey, sanitizeLicenseConfig, setLicenseConfig,
} from "../../../../lib/license";

export const runtime = "nodejs";

// Phase 6 (feature 29): role-based guard — GET needs "read", mutations
// need this route's permission (see the matrix in lib/team.ts). The
// ADMIN_PASSWORD bootstrap session acts as owner and passes everything.
async function guard(req: NextRequest, permission: Permission): Promise<Response | null> {
  const res = await requireAdmin(req, permission);
  return "error" in res ? res.error : null;
}

/**
 * License administration (Phase 5, feature 18): which products require a
 * license + activation limits, and the issued-key ledger (masked — the
 * full key exists only in the buyer's delivery email, by design).
 */
export async function GET(req: NextRequest) {
  const denied = await guard(req, "read");
  if (denied) return denied;
  const [config, keys] = await Promise.all([getLicenseConfig(), listLicenseKeys()]);
  return NextResponse.json({
    config,
    keys: keys.map((k) => ({
      id: k.id,
      masked: maskLicenseKey(k.last4),
      orderId: k.orderId,
      productId: k.productId,
      activationsUsed: k.activations.length,
      activationLimit: k.activationLimit,
      status: k.status,
      createdAt: k.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, "commerce");
  if ("error" in auth) return auth.error;
  const actor = auth.actor;
  const body = (await req.json().catch(() => null)) as
    | { action?: string; id?: string; config?: unknown }
    | null;
  if (!body?.action) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  if (body.action === "revoke") {
    if (!body.id) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const result = await revokeLicenseKey(body.id);
    if (!result.ok) return NextResponse.json({ error: "KEY_NOT_FOUND" }, { status: 404 });
    await recordAudit({ actor, action: "license.revoke", target: body.id });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "config") {
    const { persisted, value } = await setLicenseConfig(sanitizeLicenseConfig(body.config));
    return NextResponse.json({ ok: true, persisted, config: value });
  }
  return NextResponse.json({ error: "UNKNOWN_ACTION" }, { status: 400 });
}
