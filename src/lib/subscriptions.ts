/**
 * Subscriptions via Stripe Billing (Phase 4, feature 15).
 * Flag `subscriptions` — default OFF.
 *
 * Design:
 *  - Plans are owner config (Setting "subscription_plans" /
 *    .data/subscription-plans.json): { [productId]: { interval, priceUSD } }.
 *    Prices are read from this server-side config when the Stripe
 *    checkout session is built — never from the client.
 *  - Subscription state lives in the Subscription table. Stripe is the
 *    billing engine; this store is the access/dunning record. The pure
 *    reducer applySubscriptionEvent() turns webhook events into state
 *    transitions + side-effect actions, and is replay-safe:
 *    invoice.paid grants access once per period end
 *    (lastGrantedPeriodEnd), no matter how often Stripe retries.
 *  - Dunning: a failed payment flips the record to past_due; reminder
 *    emails are due at DUNNING_OFFSETS_DAYS after the failure and are
 *    sent by the cron job (/api/jobs/dunning) through the store's email
 *    service (an honest log-only no-op when Resend is not configured —
 *    the sender is injectable so tests use a mock).
 *  - No-DB fallback: subscriptions are DISABLED with a clear error
 *    (SUBSCRIPTIONS_REQUIRE_DATABASE) — subscription state must be
 *    durable, so the file fallback is used only by tests/tooling, and
 *    the customer-facing routes refuse to run without a database.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { decryptPii, encryptPii, hashSubject, piiConfigured } from "./pii.ts";
import { getProductById } from "../data/products.ts";
import { deliverOrder } from "../services/delivery/index.ts";
import { sendEmail } from "../services/email.ts";

// ─── Plans ───────────────────────────────────────────────────────────────────

export interface SubscriptionPlan {
  interval: "month" | "year";
  priceUSD: number;
}

export type SubscriptionPlanConfig = Record<string, SubscriptionPlan>;

export function sanitizePlanConfig(raw: unknown): SubscriptionPlanConfig {
  if (!raw || typeof raw !== "object") return {};
  const out: SubscriptionPlanConfig = {};
  for (const [pid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!getProductById(pid) || !v || typeof v !== "object") continue;
    const p = v as { interval?: unknown; priceUSD?: unknown };
    const price = Number(p.priceUSD);
    if (!Number.isFinite(price) || price <= 0) continue;
    out[pid] = {
      interval: p.interval === "year" ? "year" : "month",
      priceUSD: Math.round(price * 100) / 100,
    };
  }
  return out;
}

export async function getPlanConfig(): Promise<SubscriptionPlanConfig> {
  return getJsonConfig<SubscriptionPlanConfig>("subscription_plans", "subscription-plans.json", sanitizePlanConfig, {});
}

export async function setPlanConfig(config: SubscriptionPlanConfig): Promise<{ persisted: "db" | "file"; value: SubscriptionPlanConfig }> {
  return setJsonConfig("subscription_plans", "subscription-plans.json", config, sanitizePlanConfig);
}

// ─── Stripe parameter builders (pure) ────────────────────────────────────────

/** Checkout Session params for a subscription (mode=subscription). */
export function buildSubscriptionCheckoutParams(input: {
  productId: string;
  plan: SubscriptionPlan;
  productTitle: string;
  email: string;
  base: string;
  locale: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("customer_email", input.email);
  form.set("client_reference_id", `SUB-${input.productId}`);
  form.set("success_url", `${input.base}/${input.locale}/success?subscription=1`);
  form.set("cancel_url", `${input.base}/${input.locale}/product/${input.productId}`);
  form.set("metadata[kind]", "subscription");
  form.set("metadata[product_id]", input.productId);
  form.set("subscription_data[metadata][kind]", "subscription");
  form.set("subscription_data[metadata][product_id]", input.productId);
  form.set("payment_method_types[0]", "card");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(input.plan.priceUSD * 100)));
  form.set("line_items[0][price_data][recurring][interval]", input.plan.interval);
  form.set("line_items[0][price_data][product_data][name]", input.productTitle);
  return form;
}

/** Billing Portal session params (customer self-service). */
export function buildPortalParams(input: { customerId: string; base: string; locale: string }): URLSearchParams {
  const form = new URLSearchParams();
  form.set("customer", input.customerId);
  form.set("return_url", `${input.base}/${input.locale}/account`);
  return form;
}

// ─── State machine (pure reducer) ────────────────────────────────────────────

export type SubscriptionStatus = "incomplete" | "active" | "past_due" | "canceled";

export interface SubscriptionRecord {
  id: string;
  emailHash: string;
  emailCipher: string;
  productId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  lastGrantedPeriodEnd: string | null;
  pastDueSince: string | null;
  dunningStep: number;
  lastReminderAt: string | null;
  createdAt: string;
}

export type SubscriptionEvent =
  | { type: "checkout_completed"; stripeSubscriptionId: string; stripeCustomerId: string | null; email: string; productId: string }
  | { type: "invoice_paid"; stripeSubscriptionId: string; periodEndISO: string }
  | { type: "invoice_payment_failed"; stripeSubscriptionId: string; atISO: string }
  | { type: "subscription_deleted"; stripeSubscriptionId: string };

export type SubscriptionAction = "grant" | "mark_active" | "mark_past_due" | "cancel" | "none";

/**
 * Pure reducer. Returns the next record + the side-effect actions the
 * caller must perform. Replay rules: invoice.paid for an already-granted
 * period end yields NO grant action; a repeated payment_failed keeps
 * the ORIGINAL pastDueSince (the dunning clock never resets).
 */
export function applySubscriptionEvent(
  record: SubscriptionRecord | null,
  event: SubscriptionEvent,
): { record: SubscriptionRecord; actions: SubscriptionAction[] } {
  const now = new Date().toISOString();
  switch (event.type) {
    case "checkout_completed": {
      const base: SubscriptionRecord = record ?? {
        id: randomUUID(),
        emailHash: hashSubject(event.email.trim().toLowerCase()),
        emailCipher: piiConfigured() ? encryptPii(event.email.trim().toLowerCase()) : "",
        productId: event.productId,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        status: "incomplete",
        currentPeriodEnd: null,
        lastGrantedPeriodEnd: null,
        pastDueSince: null,
        dunningStep: 0,
        lastReminderAt: null,
        createdAt: now,
      };
      return {
        record: {
          ...base,
          stripeSubscriptionId: event.stripeSubscriptionId,
          stripeCustomerId: event.stripeCustomerId ?? base.stripeCustomerId,
          productId: event.productId || base.productId,
        },
        actions: ["none"],
      };
    }
    case "invoice_paid": {
      if (!record) return { record: orphanRecord(event.stripeSubscriptionId, now), actions: ["none"] };
      const alreadyGranted = record.lastGrantedPeriodEnd === event.periodEndISO;
      return {
        record: {
          ...record,
          status: "active",
          currentPeriodEnd: event.periodEndISO,
          lastGrantedPeriodEnd: event.periodEndISO,
          pastDueSince: null,
          dunningStep: 0,
        },
        actions: alreadyGranted ? ["mark_active"] : ["grant", "mark_active"],
      };
    }
    case "invoice_payment_failed": {
      if (!record) return { record: orphanRecord(event.stripeSubscriptionId, now), actions: ["none"] };
      if (record.status === "canceled") return { record, actions: ["none"] };
      return {
        record: {
          ...record,
          status: "past_due",
          pastDueSince: record.pastDueSince ?? event.atISO, // first failure starts the clock
        },
        actions: ["mark_past_due"],
      };
    }
    case "subscription_deleted": {
      if (!record) return { record: orphanRecord(event.stripeSubscriptionId, now), actions: ["none"] };
      return { record: { ...record, status: "canceled" }, actions: ["cancel"] };
    }
  }
}

function orphanRecord(stripeSubscriptionId: string, now: string): SubscriptionRecord {
  return {
    id: randomUUID(), emailHash: "", emailCipher: "", productId: "",
    stripeCustomerId: null, stripeSubscriptionId, status: "incomplete",
    currentPeriodEnd: null, lastGrantedPeriodEnd: null, pastDueSince: null,
    dunningStep: 0, lastReminderAt: null, createdAt: now,
  };
}

// ─── Dunning ─────────────────────────────────────────────────────────────────

/** Reminder offsets (days after the first failed payment). */
export const DUNNING_OFFSETS_DAYS = [0, 3, 7];

/** Subscriptions with a dunning reminder due at `now` (pure). */
export function dueDunningReminders(
  records: SubscriptionRecord[],
  now: Date = new Date(),
): { record: SubscriptionRecord; step: number }[] {
  const due: { record: SubscriptionRecord; step: number }[] = [];
  for (const record of records) {
    if (record.status !== "past_due" || !record.pastDueSince) continue;
    const step = record.dunningStep;
    if (step >= DUNNING_OFFSETS_DAYS.length) continue;
    const dueAt = new Date(record.pastDueSince).getTime() + DUNNING_OFFSETS_DAYS[step] * 24 * 3600 * 1000;
    if (now.getTime() >= dueAt) due.push({ record, step });
  }
  return due;
}

// ─── Persistence (DB → .data fallback) ───────────────────────────────────────

const STORE_PATH = path.join(process.cwd(), ".data", "subscriptions.json");

async function readStore(): Promise<SubscriptionRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as SubscriptionRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeStore(list: SubscriptionRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

/** Subscriptions require a durable DB — the customer routes check this. */
export async function subscriptionsDbAvailable(): Promise<boolean> {
  return (await getDb().catch(() => null)) !== null;
}

export async function findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRecord | null> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.subscription.findUnique({ where: { stripeSubscriptionId } });
      if (row) return fromDb(row);
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  return all.find((s) => s.stripeSubscriptionId === stripeSubscriptionId) ?? null;
}

export async function findSubscriptionByEmail(email: string): Promise<SubscriptionRecord | null> {
  const emailHash = hashSubject(email.trim().toLowerCase());
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.subscription.findFirst({
        where: { emailHash, stripeCustomerId: { not: null } },
        orderBy: { createdAt: "desc" },
      });
      if (row) return fromDb(row);
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  return [...all].reverse().find((s) => s.emailHash === emailHash && s.stripeCustomerId) ?? null;
}

export async function listSubscriptions(): Promise<SubscriptionRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.subscription.findMany({ orderBy: { createdAt: "asc" } });
      if (rows.length > 0) return rows.map(fromDb);
    } catch {
      // fall through
    }
  }
  return readStore();
}

interface DbSubscription {
  id: string; emailHash: string; emailCipher: string; productId: string;
  stripeCustomerId: string | null; stripeSubscriptionId: string | null; status: string;
  currentPeriodEnd: Date | null; lastGrantedPeriodEnd: Date | null; pastDueSince: Date | null;
  dunningStep: number; lastReminderAt: Date | null; createdAt: Date;
}

function fromDb(r: DbSubscription): SubscriptionRecord {
  return {
    id: r.id, emailHash: r.emailHash, emailCipher: r.emailCipher, productId: r.productId,
    stripeCustomerId: r.stripeCustomerId, stripeSubscriptionId: r.stripeSubscriptionId,
    status: r.status as SubscriptionStatus,
    currentPeriodEnd: r.currentPeriodEnd?.toISOString() ?? null,
    lastGrantedPeriodEnd: r.lastGrantedPeriodEnd?.toISOString() ?? null,
    pastDueSince: r.pastDueSince?.toISOString() ?? null,
    dunningStep: r.dunningStep, lastReminderAt: r.lastReminderAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

async function saveSubscription(record: SubscriptionRecord): Promise<void> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const data = {
        emailHash: record.emailHash, emailCipher: record.emailCipher, productId: record.productId,
        stripeCustomerId: record.stripeCustomerId, stripeSubscriptionId: record.stripeSubscriptionId,
        status: record.status,
        currentPeriodEnd: record.currentPeriodEnd ? new Date(record.currentPeriodEnd) : null,
        lastGrantedPeriodEnd: record.lastGrantedPeriodEnd ? new Date(record.lastGrantedPeriodEnd) : null,
        pastDueSince: record.pastDueSince ? new Date(record.pastDueSince) : null,
        dunningStep: record.dunningStep,
        lastReminderAt: record.lastReminderAt ? new Date(record.lastReminderAt) : null,
      };
      await db.subscription.upsert({
        where: { id: record.id },
        create: { id: record.id, ...data },
        update: data,
      });
      return;
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  const idx = all.findIndex((s) => s.id === record.id);
  if (idx >= 0) all[idx] = record; else all.push(record);
  await writeStore(all);
}

// ─── Webhook processing + dunning job ────────────────────────────────────────

/**
 * Apply one Stripe subscription event end-to-end: load → reduce →
 * persist → perform the grant (delivery of this cycle's product via the
 * orchestrator's email channel). Returns a summary for logging.
 */
export async function processSubscriptionEvent(
  event: SubscriptionEvent,
): Promise<{ status: SubscriptionStatus; actions: SubscriptionAction[]; granted: boolean }> {
  const existing = await findSubscriptionByStripeId(event.stripeSubscriptionId);
  const { record, actions } = applySubscriptionEvent(existing, event);
  await saveSubscription(record);
  // Phase 6, feature 26: the transition INTO past_due notifies the owner
  // (once — repeat failure events on an already-past-due record do not).
  if (actions.includes("mark_past_due") && existing?.status !== "past_due") {
    const { recordOwnerEvent } = await import("./owner-alerts.ts");
    void recordOwnerEvent({
      kind: "subscription_past_due",
      title: `Subscription past due (${record.productId})`,
      detail: { subscriptionId: record.stripeSubscriptionId, productId: record.productId },
    });
  }
  let granted = false;
  if (actions.includes("grant")) {
    const email = record.emailCipher ? decryptPii(record.emailCipher) : null;
    if (email && record.productId) {
      const cycleOrderId = `SUB-${record.stripeSubscriptionId}-${(record.currentPeriodEnd ?? "").slice(0, 10)}`;
      const outcome = await deliverOrder(
        { orderId: cycleOrderId, email, productIds: [record.productId] },
        "email",
      );
      granted = outcome.deliveredVia !== null;
    }
  }
  return { status: record.status, actions, granted };
}

export type DunningSender = (msg: { to: string; subject: string; html: string; kind: "dunning"; orderId?: string }) => Promise<{ delivered: boolean; provider: string }>;

const defaultDunningSender: DunningSender = async (msg) => sendEmail({ ...msg, kind: "dunning" });

/**
 * Dunning job body: send every due reminder and advance each record's
 * step. The sender is injectable — production passes the store email
 * service (log-only without Resend); tests pass a mock and assert the
 * exact sequence.
 */
export async function runDunningJob(
  now: Date = new Date(),
  sender: DunningSender = defaultDunningSender,
): Promise<{ checked: number; due: number; sent: number }> {
  const records = await listSubscriptions();
  const due = dueDunningReminders(records, now);
  let sent = 0;
  for (const { record, step } of due) {
    const email = record.emailCipher ? decryptPii(record.emailCipher) : null;
    if (!email) continue;
    const product = getProductById(record.productId);
    const finalNotice = step >= DUNNING_OFFSETS_DAYS.length - 1;
    await sender({
      to: email,
      kind: "dunning",
      orderId: record.stripeSubscriptionId ?? record.id,
      subject: finalNotice
        ? `Final notice: payment failed for ${product?.title ?? "your subscription"}`
        : `Payment failed for ${product?.title ?? "your subscription"} — action needed`,
      html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium Digitale Store</h1><p>We could not collect payment for your subscription to <strong>${product?.title ?? record.productId}</strong>.</p><p>${finalNotice ? "This is the final reminder — update your payment method from your account page to keep access." : "Please update your payment method from your account page; we will retry automatically."}</p></div>`,
    });
    sent++;
    await saveSubscription({ ...record, dunningStep: step + 1, lastReminderAt: now.toISOString() });
  }
  return { checked: records.length, due: due.length, sent };
}

/** Cleanup helper (tests). */
export async function deleteSubscriptionForTest(stripeSubscriptionId: string): Promise<void> {
  const all = await readStore();
  await writeStore(all.filter((s) => s.stripeSubscriptionId !== stripeSubscriptionId));
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.subscription.delete({ where: { stripeSubscriptionId } });
    } catch {
      // nothing to clean
    }
  }
}
