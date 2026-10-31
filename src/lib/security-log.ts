/**
 * Security audit log (Phase 1 upgrade, security §13).
 *
 * Distinct from the Phase-6 admin AuditLog (which records what admins
 * DID): this log records what was ATTEMPTED against the store —
 * failed logins, lockouts, denied admin access, CSRF rejections,
 * webhook signature failures, dispute events, session terminations.
 * Owner alerts fire for the suspicious kinds via the existing owner
 * alert center (recordOwnerEvent), and an alert email goes out when
 * ADMIN_ALERT_EMAIL + Resend are configured.
 *
 * Storage: SecurityLog table when a DB is configured, else
 * .data/security-log.json (capped). Entries NEVER contain passwords,
 * tokens, full emails (actor emails are stored hashed beyond a masked
 * form) or request bodies.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { maskEmail } from "./http.ts";

export type SecurityEventKind =
  | "login_failed"
  | "login_locked"
  | "login_success_new_device"
  | "admin_access_denied"
  | "csrf_rejected"
  | "webhook_bad_signature"
  | "webhook_replay"
  | "payment_dispute"
  | "order_refunded"
  | "upload_magic_rejected"
  | "sessions_terminated"
  | "totp_enrolled"
  | "step_up_granted"
  | "rate_limited"
  // Phase 4 upgrade: the provider executed an office refund but the
  // ledger refused to record it — a human must reconcile.
  | "refund_ledger_mismatch"
  // Phase 5 upgrade: an AI employee (or text planted where an employee
  // could read it) attempted a forbidden/unknown tool action. The tool
  // layer refused it; the event exists so the owner can SEE attempts.
  | "ai_forbidden_attempt";

export interface SecurityEventRecord {
  id: string;
  kind: SecurityEventKind;
  actor: string; // masked email, "bootstrap-owner", "ip:…", or "system"
  detail: Record<string, unknown> | null;
  createdAt: string;
}

const FILE_PATH = path.join(process.cwd(), ".data", "security-log.json");
const FILE_CAP = 5000;

/** Kinds that also raise an owner alert (in-app center + optional email). */
const ALERT_KINDS = new Set<SecurityEventKind>([
  "login_locked",
  "login_success_new_device",
  "payment_dispute",
  "sessions_terminated",
  "refund_ledger_mismatch",
]);

export function maskActor(raw: string): string {
  if (raw.includes("@")) return maskEmail(raw) ?? "***";
  return raw.slice(0, 64);
}

export function hashActor(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

async function readFileLog(): Promise<SecurityEventRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE_PATH, "utf8")) as SecurityEventRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Append one security event. Never throws — monitoring must not break
 * the flow it observes. Sensitive values must not be passed in detail.
 */
export async function recordSecurityEvent(input: {
  kind: SecurityEventKind;
  actor?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const entry: SecurityEventRecord = {
    id: randomUUID(),
    kind: input.kind,
    actor: maskActor(input.actor ?? "system"),
    detail: input.detail ?? null,
    createdAt: new Date().toISOString(),
  };
  try {
    const db = await getDb();
    if (db) {
      await db.securityLog.create({
        data: {
          id: entry.id,
          kind: entry.kind,
          actor: entry.actor,
          actorHash: hashActor(input.actor ?? "system"),
          detail: (entry.detail ?? undefined) as import("@prisma/client").Prisma.InputJsonValue | undefined,
        },
      });
    } else {
      throw new Error("no-db");
    }
  } catch {
    try {
      const all = await readFileLog();
      all.push(entry);
      await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
      await fs.writeFile(FILE_PATH, JSON.stringify(all.slice(-FILE_CAP), null, 2), "utf8");
    } catch { /* never break the caller */ }
  }
  if (ALERT_KINDS.has(entry.kind)) {
    try {
      const { recordOwnerEvent } = await import("./owner-alerts.ts");
      await recordOwnerEvent({
        kind: "security_alert",
        title: `Security: ${entry.kind} (${entry.actor})`,
        detail: { kind: entry.kind, ...(entry.detail ?? {}) },
      });
    } catch { /* alerting is best-effort */ }
    const alertEmail = process.env.ADMIN_ALERT_EMAIL;
    if (alertEmail) {
      try {
        const { sendEmail } = await import("../services/email.ts");
        await sendEmail({
          to: alertEmail,
          subject: `Astralium security alert: ${entry.kind}`,
          kind: "security",
          html: `<p>Security event <strong>${entry.kind}</strong> for ${entry.actor} at ${entry.createdAt}.</p><p>This is an automated alert from your store's security log. No action is needed if this was you.</p>`,
        });
      } catch { /* best-effort */ }
    }
  }
}

export async function listSecurityEvents(limit = 200): Promise<SecurityEventRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.securityLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as SecurityEventKind,
        actor: r.actor,
        detail: (r.detail as Record<string, unknown> | null) ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    }
  } catch { /* fall through */ }
  const all = await readFileLog();
  return all.slice(-limit).reverse();
}
