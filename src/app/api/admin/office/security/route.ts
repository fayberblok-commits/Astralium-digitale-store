import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { listAudit, requireAdmin } from "../../../../../lib/team";
import { listSecurityEvents } from "../../../../../lib/security-log";
import { loadSecurityState } from "../../../../../lib/security-state";
import { adminSessionIdleMs, providerStatus } from "../../../../../lib/admin";

export const runtime = "nodejs";

/**
 * Manager's Office — security center (Phase 4 upgrade, item 8).
 *
 * `security` permission = the owner alone. Aggregates what the
 * platform can honestly show:
 *  - sessions: admin sessions are stateless signed tokens, so there
 *    is no per-device session list to fabricate — the center shows
 *    the live session epoch (terminate-all state), the idle/absolute
 *    policy, locked accounts and known-device counts, all real.
 *  - the security event log + a SEARCHABLE audit log (?q=).
 *  - backup status: the encrypted backup files on disk (the backup
 *    job itself is scripts/backup-db.mjs — Phase 1).
 *  - system health: provider configuration presence + the last 24h
 *    of security-relevant event counts. Nothing here pretends to be
 *    an APM: latencies/error rates beyond these signals are not
 *    measured by this codebase and are not invented.
 */
async function backupStatus(): Promise<{ files: { name: string; sizeBytes: number; modifiedAt: string }[]; lastBackupAt: string | null }> {
  const dir = path.join(process.cwd(), "backups");
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".enc"));
    const files = [];
    for (const name of names) {
      const stat = await fs.stat(path.join(dir, name));
      files.push({ name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return { files: files.slice(0, 10), lastBackupAt: files[0]?.modifiedAt ?? null };
  } catch {
    return { files: [], lastBackupAt: null };
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req, "security");
  if ("error" in auth) return auth.error;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const [state, events, auditAll, backups] = await Promise.all([
    loadSecurityState(), listSecurityEvents(100), listAudit(500), backupStatus(),
  ]);
  const now = Date.now();
  const lockedAccounts = Object.entries(state.loginGuards)
    .filter(([, g]) => g.lockedUntil > now)
    .map(([account, g]) => ({ account, lockedUntil: new Date(g.lockedUntil).toISOString() }));
  const last24h = events.filter((e) => now - new Date(e.createdAt).getTime() < 24 * 3600 * 1000);
  const countBy = (kind: string) => last24h.filter((e) => e.kind === kind).length;
  const audit = q
    ? auditAll.filter((e) =>
        e.actor.toLowerCase().includes(q) || e.action.toLowerCase().includes(q) || e.target.toLowerCase().includes(q))
    : auditAll;

  return NextResponse.json({
    sessions: {
      epoch: state.sessionEpoch,
      idleMinutes: Math.round(adminSessionIdleMs() / 60000),
      absoluteHours: 8,
      lockedAccounts,
      knownDevices: Object.fromEntries(Object.entries(state.knownDevices).map(([k, v]) => [k, v.length])),
      note: "Sessions are stateless signed tokens; terminate-all works by bumping the epoch (Security panel).",
    },
    alerts24h: {
      total: last24h.length,
      loginFailed: countBy("login_failed"),
      loginLocked: countBy("login_locked"),
      accessDenied: countBy("admin_access_denied"),
      webhookBadSignature: countBy("webhook_bad_signature"),
      disputes: countBy("payment_dispute"),
      refunds: countBy("order_refunded"),
    },
    events,
    audit: audit.slice(0, 200),
    backups,
    health: {
      providers: providerStatus(),
      ownerTotp: {
        enrolled: Boolean(state.ownerTotp),
        enabled: state.ownerTotp?.enabled ?? false,
        backupCodesRemaining: state.ownerTotp?.backupCodeHashes.length ?? 0,
      },
      serverTime: new Date(now).toISOString(),
    },
  });
}
