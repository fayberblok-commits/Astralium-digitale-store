import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/team";
import { loadSecurityState } from "../../../../lib/security-state";
import { listSecurityEvents } from "../../../../lib/security-log";

export const runtime = "nodejs";

/**
 * Security center data (Phase 1 upgrade, §13): recent security-log
 * events, the current session epoch, owner TOTP status and which
 * accounts are currently locked out. Read-only; "audit" permission.
 * Never returns secrets, hashes of codes, or full emails (the log
 * stores masked actors by construction).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "audit");
  if ("error" in auth) return auth.error;
  const state = await loadSecurityState();
  const now = Date.now();
  const lockedAccounts = Object.entries(state.loginGuards)
    .filter(([, g]) => g.lockedUntil > now)
    .map(([account, g]) => ({ account, lockedUntil: new Date(g.lockedUntil).toISOString() }));
  return NextResponse.json({
    epoch: state.sessionEpoch,
    ownerTotp: {
      enrolled: Boolean(state.ownerTotp),
      enabled: state.ownerTotp?.enabled ?? false,
      backupCodesRemaining: state.ownerTotp?.backupCodeHashes.length ?? 0,
    },
    lockedAccounts,
    knownDeviceCounts: Object.fromEntries(
      Object.entries(state.knownDevices).map(([k, v]) => [k, v.length]),
    ),
    events: await listSecurityEvents(100),
  });
}
