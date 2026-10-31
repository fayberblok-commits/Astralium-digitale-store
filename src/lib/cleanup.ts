/**
 * Periodic security/housekeeping cleanup (Phase 1 upgrade, §11).
 *
 * Removes only EPHEMERAL records — expired claim codes, stale login
 * guards, aged security-log entries. Financial records (orders, grants)
 * are never deleted here; grants are revoked, not erased, and orders
 * are the store's books.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "./db.ts";
import { loadSecurityState, saveSecurityState } from "./security-state.ts";

export interface CleanupSummary {
  claimCodesRemoved: number;
  guardsPruned: number;
  securityLogPruned: number;
}

const SECURITY_LOG_FILE = path.join(process.cwd(), ".data", "security-log.json");
export const SECURITY_LOG_RETENTION_DAYS = 90;

export async function runSecurityCleanup(nowMs: number = Date.now()): Promise<CleanupSummary> {
  const summary: CleanupSummary = { claimCodesRemoved: 0, guardsPruned: 0, securityLogPruned: 0 };
  const now = new Date(nowMs);

  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const res = await db.claimCode.deleteMany({ where: { expiresAt: { lt: now } } });
      summary.claimCodesRemoved = res.count;
    } catch { /* table may not exist yet — cleanup stays a no-op */ }
    try {
      const cutoff = new Date(nowMs - SECURITY_LOG_RETENTION_DAYS * 24 * 3600 * 1000);
      const res = await db.securityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      summary.securityLogPruned = res.count;
    } catch { /* same */ }
  }

  // File-mode security log pruning (same retention).
  if (!db) {
    try {
      const raw = JSON.parse(await fs.readFile(SECURITY_LOG_FILE, "utf8")) as { createdAt: string }[];
      if (Array.isArray(raw)) {
        const cutoff = nowMs - SECURITY_LOG_RETENTION_DAYS * 24 * 3600 * 1000;
        const kept = raw.filter((e) => new Date(e.createdAt).getTime() >= cutoff);
        summary.securityLogPruned = raw.length - kept.length;
        if (summary.securityLogPruned > 0) {
          await fs.writeFile(SECURITY_LOG_FILE, JSON.stringify(kept, null, 2), "utf8");
        }
      }
    } catch { /* no file — nothing to prune */ }
  }

  // Login guards: drop entries whose window has fully passed and that
  // are not locked — the state document stays small forever.
  try {
    const state = await loadSecurityState();
    let pruned = 0;
    for (const [key, g] of Object.entries(state.loginGuards)) {
      const lastFailure = g.failures.length > 0 ? Math.max(...g.failures) : 0;
      if (g.lockedUntil <= nowMs && lastFailure < nowMs - 24 * 3600 * 1000) {
        delete state.loginGuards[key];
        pruned += 1;
      }
    }
    if (pruned > 0) await saveSecurityState(state);
    summary.guardsPruned = pruned;
  } catch { /* best-effort */ }

  return summary;
}
