/**
 * Owner notification center (Phase 6, feature 26). Flag `owner_alerts`
 * — default ON for the in-app inbox (it sends nothing externally).
 *
 * Events are recorded from the real flows: Stripe/PayPal fulfilment
 * (order_paid), the fraud shield (fraud_hold), the delivery
 * orchestrator (delivery_failed), review submission (review_pending)
 * and subscription processing (subscription_past_due). Recording never
 * throws and never blocks the flow that produced the event.
 *
 * External fan-out is opt-in per channel and honest:
 *  - Telegram: only when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set.
 *  - WhatsApp: only when the Phase-2 `delivery_whatsapp` flag is ON,
 *    the WhatsApp provider is configured, AND the owner saved a number
 *    in the alert settings — sent via the Phase-2 channel's text send.
 *  - Email: batched digest via the cron job (never one email per event),
 *    only when the owner saved a digest address in the alert settings.
 * Without configuration each leg reports `skipped` with a reason —
 * nothing is faked as sent.
 *
 * Storage: OwnerEvent table, else .data/owner-alerts.json (capped).
 * Settings live in the config-store (`owner_alerts_config`).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getFlag } from "./flags.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { sendEmail } from "../services/email.ts";
import { envPresent } from "../services/delivery/meta.ts";
import { sendWhatsAppText } from "../services/delivery/whatsapp.ts";

export type OwnerEventKind =
  | "order_paid" | "fraud_hold" | "delivery_failed" | "review_pending" | "subscription_past_due"
  // Phase 1 upgrade: security alerts from the security log (§13).
  | "security_alert"
  // Phase 4 upgrade: a customer opened a support ticket (human handoff).
  | "support_ticket";

export const OWNER_EVENT_KINDS: OwnerEventKind[] = [
  "order_paid", "fraud_hold", "delivery_failed", "review_pending", "subscription_past_due",
  "security_alert", "support_ticket",
];

export interface OwnerEventRecord {
  id: string;
  kind: OwnerEventKind;
  title: string;
  detail: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "owner-alerts.json");
const FILE_CAP = 2000;

async function readFileEvents(): Promise<OwnerEventRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as OwnerEventRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeFileEvents(list: OwnerEventRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list.slice(-FILE_CAP), null, 2), "utf8");
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface OwnerAlertsConfig {
  /** Digest recipient; empty = digest disabled. */
  email: string;
  /** Owner's WhatsApp number (E.164 digits); empty = WhatsApp leg disabled. */
  whatsappNumber: string;
  /** Master switch for the Telegram leg (keys still required). */
  telegramEnabled: boolean;
}

export const EMPTY_ALERTS_CONFIG: OwnerAlertsConfig = { email: "", whatsappNumber: "", telegramEnabled: true };

export function sanitizeAlertsConfig(raw: unknown): OwnerAlertsConfig {
  const r = (raw ?? {}) as Partial<OwnerAlertsConfig>;
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase().slice(0, 200) : "";
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    whatsappNumber: typeof r.whatsappNumber === "string" ? r.whatsappNumber.replace(/[^0-9]/g, "").slice(0, 20) : "",
    telegramEnabled: r.telegramEnabled !== false,
  };
}

export async function getAlertsConfig(): Promise<OwnerAlertsConfig> {
  return getJsonConfig("owner_alerts_config", "owner-alerts-config.json", sanitizeAlertsConfig, EMPTY_ALERTS_CONFIG);
}

export async function setAlertsConfig(value: OwnerAlertsConfig): Promise<{ persisted: "db" | "file"; value: OwnerAlertsConfig }> {
  return setJsonConfig("owner_alerts_config", "owner-alerts-config.json", value, sanitizeAlertsConfig);
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// ─── Recorder ────────────────────────────────────────────────────────────────

/**
 * Record one owner event + fan out to the configured external channels.
 * Fire-and-forget safe: swallows every error; returns the record (or
 * null when the flag is off / storage failed). `deps` exists for tests.
 */
export async function recordOwnerEvent(
  input: { kind: OwnerEventKind; title: string; detail?: Record<string, unknown> },
  deps?: { fanOut?: typeof fanOutOwnerEvent },
): Promise<OwnerEventRecord | null> {
  try {
    if (!(await getFlag("owner_alerts"))) return null;
    const record: OwnerEventRecord = {
      id: randomUUID(),
      kind: input.kind,
      title: input.title.slice(0, 300),
      detail: input.detail ?? null,
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    let stored = false;
    const db = await getDb().catch(() => null);
    if (db) {
      try {
        const row = await db.ownerEvent.create({
          data: {
            kind: record.kind, title: record.title,
            detail: (record.detail ?? undefined) as import("@prisma/client").Prisma.InputJsonValue | undefined,
          },
        });
        record.id = row.id;
        record.createdAt = row.createdAt.toISOString();
        stored = true;
      } catch { /* fall through to file */ }
    }
    if (!stored) {
      const all = await readFileEvents();
      all.push(record);
      await writeFileEvents(all);
    }
    // External fan-out must never break the producing flow.
    void (deps?.fanOut ?? fanOutOwnerEvent)(record).catch(() => undefined);
    return record;
  } catch {
    return null;
  }
}

export async function listOwnerEvents(opts: { kind?: string; unreadOnly?: boolean; limit?: number } = {}): Promise<OwnerEventRecord[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.ownerEvent.findMany({
        where: {
          ...(opts.kind ? { kind: opts.kind } : {}),
          ...(opts.unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      if (rows.length > 0 || opts.kind || opts.unreadOnly) {
        return rows.map((r) => ({
          id: r.id, kind: r.kind as OwnerEventKind, title: r.title,
          detail: (r.detail as Record<string, unknown> | null) ?? null,
          readAt: r.readAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch { /* fall through */ }
  }
  let all = await readFileEvents();
  if (opts.kind) all = all.filter((e) => e.kind === opts.kind);
  if (opts.unreadOnly) all = all.filter((e) => !e.readAt);
  return all.slice(-limit).reverse();
}

export async function countUnreadOwnerEvents(): Promise<number> {
  const db = await getDb().catch(() => null);
  if (db) {
    try { return await db.ownerEvent.count({ where: { readAt: null } }); } catch { /* fall through */ }
  }
  return (await readFileEvents()).filter((e) => !e.readAt).length;
}

export async function markOwnerEventRead(id: string): Promise<{ ok: boolean }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.ownerEvent.update({ where: { id }, data: { readAt: new Date() } });
      return { ok: true };
    } catch { /* fall through */ }
  }
  const all = await readFileEvents();
  const ev = all.find((e) => e.id === id);
  if (!ev) return { ok: false };
  ev.readAt = new Date().toISOString();
  await writeFileEvents(all);
  return { ok: true };
}

export async function markAllOwnerEventsRead(): Promise<{ marked: number }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const res = await db.ownerEvent.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
      return { marked: res.count };
    } catch { /* fall through */ }
  }
  const all = await readFileEvents();
  const now = new Date().toISOString();
  let marked = 0;
  for (const e of all) if (!e.readAt) { e.readAt = now; marked++; }
  if (marked > 0) await writeFileEvents(all);
  return { marked };
}

/** Retention: delete read events older than `days` (privacy cleanup job). */
export async function pruneReadOwnerEvents(days: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const res = await db.ownerEvent.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: cutoff } } });
      return res.count;
    } catch { /* fall through */ }
  }
  const all = await readFileEvents();
  const kept = all.filter((e) => !(e.readAt && new Date(e.createdAt) < cutoff));
  if (kept.length !== all.length) await writeFileEvents(kept);
  return all.length - kept.length;
}

// ─── External fan-out ────────────────────────────────────────────────────────

export type FanOutLeg = "sent" | "skipped" | "failed";
export interface FanOutResult {
  telegram: { status: FanOutLeg; reason?: string };
  whatsapp: { status: FanOutLeg; reason?: string };
}

export function alertText(e: OwnerEventRecord): string {
  return `Astralium — ${e.title}`;
}

/**
 * Fan one event out to Telegram / WhatsApp. Email is deliberately NOT
 * here (digests only, see buildDigest + the cron job). Injectable
 * fetch/senders keep every leg mock-testable with zero real calls.
 */
export async function fanOutOwnerEvent(
  event: OwnerEventRecord,
  deps: {
    fetchFn?: typeof fetch;
    sendWhatsapp?: (toWaId: string, text: string) => Promise<{ ok: boolean }>;
    config?: OwnerAlertsConfig;
    whatsappFlag?: boolean;
  } = {},
): Promise<FanOutResult> {
  const config = deps.config ?? (await getAlertsConfig());
  const result: FanOutResult = {
    telegram: { status: "skipped", reason: "NOT_CONFIGURED" },
    whatsapp: { status: "skipped", reason: "NOT_CONFIGURED" },
  };
  // Telegram leg
  if (!config.telegramEnabled) {
    result.telegram = { status: "skipped", reason: "DISABLED_IN_SETTINGS" };
  } else if (telegramConfigured()) {
    try {
      const fetchFn = deps.fetchFn ?? fetch;
      const res = await fetchFn(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: alertText(event) }),
      });
      result.telegram = res.ok ? { status: "sent" } : { status: "failed", reason: `TELEGRAM_HTTP_${res.status}` };
    } catch {
      result.telegram = { status: "failed", reason: "NETWORK_ERROR" };
    }
  }
  // WhatsApp leg — Phase-2 channel, only when its flag + provider + an
  // owner number in settings are all present.
  const waFlag = deps.whatsappFlag ?? (await getFlag("delivery_whatsapp"));
  const waReady = envPresent("WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN").ok;
  if (!waFlag) {
    result.whatsapp = { status: "skipped", reason: "FLAG_OFF" };
  } else if (!waReady) {
    result.whatsapp = { status: "skipped", reason: "PROVIDER_NOT_CONFIGURED" };
  } else if (!config.whatsappNumber) {
    result.whatsapp = { status: "skipped", reason: "NO_OWNER_NUMBER" };
  } else {
    try {
      const send = deps.sendWhatsapp ?? (async (to: string, text: string) => {
        const r = await sendWhatsAppText(to, text);
        return { ok: r.ok };
      });
      const r = await send(config.whatsappNumber, alertText(event));
      result.whatsapp = r.ok ? { status: "sent" } : { status: "failed", reason: "PROVIDER_REJECTED" };
    } catch {
      result.whatsapp = { status: "failed", reason: "NETWORK_ERROR" };
    }
  }
  return result;
}

// ─── Email digest ────────────────────────────────────────────────────────────

export function buildDigest(events: OwnerEventRecord[]): { subject: string; html: string; count: number } {
  const rows = events
    .map((e) => `<tr><td style="padding:6px 0">${e.title}</td><td style="padding:6px 0;color:#666">${new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</td></tr>`)
    .join("");
  return {
    subject: `Astralium owner digest — ${events.length} new event${events.length === 1 ? "" : "s"}`,
    count: events.length,
    html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium — owner digest</h1><table>${rows}</table><p>Open the admin notification center for details.</p></div>`,
  };
}

interface DigestState { lastDigestAt: string | null }
const EMPTY_DIGEST_STATE: DigestState = { lastDigestAt: null };

function sanitizeDigestState(raw: unknown): DigestState {
  const r = (raw ?? {}) as Partial<DigestState>;
  return { lastDigestAt: typeof r.lastDigestAt === "string" ? r.lastDigestAt : null };
}

/**
 * Digest job body: emails all events recorded since the last digest to
 * the configured address, then advances the watermark. Honest no-ops:
 * no address → skipped; email provider absent → sendEmail reports
 * delivered:false and the watermark does NOT advance (retry next run).
 */
export async function runOwnerDigest(
  deps: { send?: typeof sendEmail; config?: OwnerAlertsConfig } = {},
): Promise<{ sent: boolean; events: number; reason?: string }> {
  const config = deps.config ?? (await getAlertsConfig());
  if (!config.email) return { sent: false, events: 0, reason: "NO_DIGEST_EMAIL" };
  const state = await getJsonConfig("owner_alerts_digest_state", "owner-alerts-digest.json", sanitizeDigestState, EMPTY_DIGEST_STATE);
  const since = state.lastDigestAt ? new Date(state.lastDigestAt) : new Date(0);
  const all = await listOwnerEvents({ limit: 500 });
  const fresh = all.filter((e) => new Date(e.createdAt) > since).reverse();
  if (fresh.length === 0) return { sent: false, events: 0, reason: "NOTHING_NEW" };
  const digest = buildDigest(fresh);
  const send = deps.send ?? sendEmail;
  const res = await send({ to: config.email, subject: digest.subject, html: digest.html, kind: "owner-alert" });
  if (!res.delivered) return { sent: false, events: fresh.length, reason: "EMAIL_NOT_DELIVERED" };
  await setJsonConfig("owner_alerts_digest_state", "owner-alerts-digest.json",
    { lastDigestAt: fresh[fresh.length - 1].createdAt }, sanitizeDigestState);
  return { sent: true, events: fresh.length };
}
