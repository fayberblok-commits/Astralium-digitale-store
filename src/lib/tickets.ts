/**
 * Support tickets (Phase 4 upgrade — Manager's Office, item 6).
 *
 * The human side of support: the AI assistant has always offered a
 * human handoff ("leave your email and we will reply") — this module
 * is where those requests actually land. Intake is the public
 * POST /api/support/ticket (rate-limited + captcha-gated there);
 * handling happens entirely in the office (list, filter, answer,
 * close). Dual-mode storage like the rest of the platform: the
 * SupportTicket table when a database is configured, else
 * .data/tickets.json.
 *
 * Ticket bodies are customer PII: they are never written to the audit
 * or security logs (the office API audits ticket IDS and statuses only).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";

export type TicketStatus = "open" | "answered" | "closed";
export const TICKET_STATUSES: TicketStatus[] = ["open", "answered", "closed"];

export interface TicketRecord {
  id: string;
  email: string;
  subject: string;
  message: string;
  orderRef: string | null;
  locale: string | null;
  status: TicketStatus;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
}

const FILE_PATH = path.join(process.cwd(), ".data", "tickets.json");
const FILE_CAP = 5000;

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === "string" && (TICKET_STATUSES as string[]).includes(v);
}

/** Allowed status transitions: anything may close; a closed ticket can be reopened to open. */
export function canTicketTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false;
  const allowed: Record<TicketStatus, TicketStatus[]> = {
    open: ["answered", "closed"],
    answered: ["open", "closed"],
    closed: ["open"],
  };
  return allowed[from].includes(to);
}

export function sanitizeTicketInput(raw: unknown): { email: string; subject: string; message: string; orderRef: string | null; locale: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase().slice(0, 160) : "";
  const subject = typeof r.subject === "string" ? r.subject.trim().slice(0, 160) : "";
  const message = typeof r.message === "string" ? r.message.trim().slice(0, 5000) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !subject || message.length < 4) return null;
  return {
    email,
    subject,
    message,
    orderRef: typeof r.orderRef === "string" && r.orderRef.trim() ? r.orderRef.trim().slice(0, 80) : null,
    locale: typeof r.locale === "string" ? r.locale.slice(0, 8) : null,
  };
}

async function readFileTickets(): Promise<TicketRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE_PATH, "utf8")) as TicketRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeFileTickets(list: TicketRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(list.slice(-FILE_CAP), null, 2), "utf8");
}

type DbTicket = {
  id: string; email: string; subject: string; message: string; orderRef: string | null;
  locale: string | null; status: string; adminNote: string; createdAt: Date; updatedAt: Date;
};

function fromDb(row: DbTicket): TicketRecord {
  return {
    id: row.id, email: row.email, subject: row.subject, message: row.message,
    orderRef: row.orderRef, locale: row.locale,
    status: isTicketStatus(row.status) ? row.status : "open",
    adminNote: row.adminNote, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createTicket(input: ReturnType<typeof sanitizeTicketInput> & object): Promise<TicketRecord> {
  const now = new Date().toISOString();
  const record: TicketRecord = {
    id: randomUUID(), status: "open", adminNote: "", ...input, createdAt: now, updatedAt: now,
  };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.supportTicket.create({
        data: {
          id: record.id, email: record.email, subject: record.subject, message: record.message,
          orderRef: record.orderRef, locale: record.locale, status: "open",
        },
      });
      return fromDb(row as DbTicket);
    } catch { /* fall through to file */ }
  }
  const all = await readFileTickets();
  all.push(record);
  await writeFileTickets(all);
  return record;
}

export async function listTickets(opts: { status?: TicketStatus; limit?: number } = {}): Promise<TicketRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.supportTicket.findMany({
        where: opts.status ? { status: opts.status } : undefined,
        orderBy: { createdAt: "desc" },
        take: opts.limit ?? 200,
      });
      if (rows.length > 0) return rows.map((r) => fromDb(r as DbTicket));
    } catch { /* fall through */ }
  }
  const all = await readFileTickets();
  return all
    .filter((t) => !opts.status || t.status === opts.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, opts.limit ?? 200);
}

export async function updateTicket(
  id: string,
  patch: { status?: TicketStatus; adminNote?: string },
): Promise<{ ok: boolean; ticket?: TicketRecord; error?: string }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.supportTicket.findUnique({ where: { id } });
      if (row) {
        const current = fromDb(row as DbTicket);
        if (patch.status && patch.status !== current.status && !canTicketTransition(current.status, patch.status)) {
          return { ok: false, error: "ILLEGAL_TRANSITION" };
        }
        const updated = await db.supportTicket.update({
          where: { id },
          data: {
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote.slice(0, 2000) } : {}),
          },
        });
        return { ok: true, ticket: fromDb(updated as DbTicket) };
      }
    } catch { /* fall through */ }
  }
  const all = await readFileTickets();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, error: "NOT_FOUND" };
  const current = all[idx];
  if (patch.status && patch.status !== current.status && !canTicketTransition(current.status, patch.status)) {
    return { ok: false, error: "ILLEGAL_TRANSITION" };
  }
  const next: TicketRecord = {
    ...current,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.adminNote !== undefined ? { adminNote: patch.adminNote.slice(0, 2000) } : {}),
    updatedAt: new Date().toISOString(),
  };
  all[idx] = next;
  await writeFileTickets(all);
  return { ok: true, ticket: next };
}
