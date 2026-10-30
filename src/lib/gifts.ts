/**
 * Gift purchases (Phase 4, feature 10). Flag `gifts` — default OFF.
 *
 * At checkout the buyer may mark items as gifts with a recipient email,
 * an optional message and an optional send date. The rules:
 *
 *  - The recipient email is stored ONLY as SHA-256 hash + AES-256-GCM
 *    ciphertext (lib/pii.ts) — creating a gift is refused when PII
 *    encryption is not configured, exactly like wishlist alerts.
 *  - Delivery goes to the RECIPIENT through the existing delivery
 *    orchestrator (email channel; email is the always-on fallback), and
 *    a one-time claim code is issued so the recipient can also pull the
 *    links via WhatsApp/Messenger/Instagram (Phase 2 claim path).
 *  - The buyer receives a confirmation that contains NO download link
 *    and NO claim code — giftBuyerConfirmationHtml is unit-tested to
 *    contain neither.
 *  - Scheduled gifts (sendAt in the future) are held: status becomes
 *    "scheduled" at payment and the cron job (/api/jobs/gifts) delivers
 *    them when the date arrives.
 *
 * Persistence: Gift table when a DB is configured, else .data/gifts.json.
 * Status flow: pending → scheduled → sent (or pending → sent).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getProductById } from "../data/products.ts";
import { decryptPii, encryptPii, hashSubject, piiConfigured } from "./pii.ts";
import { deliverOrder } from "../services/delivery/index.ts";
import { issueClaimCode } from "./claim-codes.ts";
import { sendEmail } from "../services/email.ts";

export interface GiftRecord {
  id: string;
  orderId: string;
  productId: string;
  buyerEmail: string;
  recipientEmailHash: string;
  recipientEmailCipher: string;
  message: string | null;
  sendAt: string | null; // ISO
  status: "pending" | "scheduled" | "sent" | "failed";
  createdAt: string;
  sentAt: string | null;
}

export interface GiftInput {
  productId: string;
  recipientEmail: string;
  message?: string;
  sendAt?: string; // ISO date — optional scheduled delivery
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** "jane.doe@example.com" → "ja***@example.com" — safe for confirmations. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${(local ?? "").slice(0, 2)}***@${domain}`;
}

export function validateGiftInput(input: GiftInput): { ok: boolean; error?: string } {
  if (!getProductById(input.productId)) return { ok: false, error: "PRODUCT_NOT_FOUND" };
  if (!EMAIL_RE.test(localSafe(input.recipientEmail))) return { ok: false, error: "INVALID_RECIPIENT_EMAIL" };
  if (input.message && input.message.length > 500) return { ok: false, error: "MESSAGE_TOO_LONG" };
  if (input.sendAt && Number.isNaN(new Date(input.sendAt).getTime())) return { ok: false, error: "INVALID_SEND_DATE" };
  return { ok: true };
}

function localSafe(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Buyer confirmation HTML. SECURITY INVARIANT (unit-tested): this HTML
 * must never contain a download URL or a claim code — the buyer paid,
 * but the files belong to the recipient.
 */
export function giftBuyerConfirmationHtml(params: {
  orderId: string;
  gifts: { title: string; recipientMasked: string; sendAt: string | null }[];
}): string {
  const rows = params.gifts
    .map(
      (g) =>
        `<tr><td style="padding:8px 0">${g.title}</td><td>→ ${g.recipientMasked}${g.sendAt ? ` · scheduled for ${g.sendAt.slice(0, 10)}` : ""}</td></tr>`,
    )
    .join("");
  return `<div style="font-family:Georgia,serif;color:#10131f">
    <h1>Astralium Digitale Store</h1>
    <p>Thank you — your gift order <strong>${params.orderId}</strong> is confirmed.</p>
    <table>${rows}</table>
    <p>Your gift(s) are delivered directly to the recipient(s) — download links are never included in this confirmation, by design.</p>
  </div>`;
}

/** Which pending gifts deliver now vs. wait for their send date (pure). */
export function planGiftActions(
  gifts: GiftRecord[],
  now: Date = new Date(),
): { deliverNow: GiftRecord[]; schedule: GiftRecord[] } {
  const deliverNow: GiftRecord[] = [];
  const schedule: GiftRecord[] = [];
  for (const gift of gifts) {
    if (gift.status !== "pending") continue;
    if (gift.sendAt && new Date(gift.sendAt).getTime() > now.getTime()) schedule.push(gift);
    else deliverNow.push(gift);
  }
  return { deliverNow, schedule };
}

/** Scheduled gifts whose send date has arrived (pure). */
export function dueScheduledGifts(gifts: GiftRecord[], now: Date = new Date()): GiftRecord[] {
  return gifts.filter(
    (g) => g.status === "scheduled" && g.sendAt !== null && new Date(g.sendAt).getTime() <= now.getTime(),
  );
}

// ─── Store (DB → .data fallback) ─────────────────────────────────────────────

const STORE_PATH = path.join(process.cwd(), ".data", "gifts.json");

async function readStore(): Promise<GiftRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as GiftRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeStore(list: GiftRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

interface DbGift {
  id: string; orderId: string; productId: string; buyerEmail: string;
  recipientEmailHash: string; recipientEmailCipher: string; message: string | null;
  sendAt: Date | null; status: string; createdAt: Date; sentAt: Date | null;
}

function fromDb(r: DbGift): GiftRecord {
  return {
    id: r.id, orderId: r.orderId, productId: r.productId, buyerEmail: r.buyerEmail,
    recipientEmailHash: r.recipientEmailHash, recipientEmailCipher: r.recipientEmailCipher,
    message: r.message, sendAt: r.sendAt?.toISOString() ?? null,
    status: r.status as GiftRecord["status"], createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  };
}

export async function createGifts(
  orderId: string,
  buyerEmail: string,
  inputs: GiftInput[],
): Promise<{ ok: boolean; error?: string; gifts?: GiftRecord[] }> {
  if (!piiConfigured()) return { ok: false, error: "PII_NOT_CONFIGURED" };
  const records: GiftRecord[] = [];
  for (const input of inputs) {
    const check = validateGiftInput(input);
    if (!check.ok) return { ok: false, error: check.error };
    const recipient = input.recipientEmail.trim().toLowerCase();
    records.push({
      id: randomUUID(),
      orderId,
      productId: input.productId,
      buyerEmail: buyerEmail.trim().toLowerCase(),
      recipientEmailHash: hashSubject(recipient),
      recipientEmailCipher: encryptPii(recipient),
      message: input.message?.slice(0, 500) ?? null,
      sendAt: input.sendAt ? new Date(input.sendAt).toISOString() : null,
      status: "pending",
      createdAt: new Date().toISOString(),
      sentAt: null,
    });
  }
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      for (const r of records) {
        await db.gift.upsert({
          where: { orderId_productId: { orderId: r.orderId, productId: r.productId } },
          create: {
            id: r.id, orderId: r.orderId, productId: r.productId, buyerEmail: r.buyerEmail,
            recipientEmailHash: r.recipientEmailHash, recipientEmailCipher: r.recipientEmailCipher,
            message: r.message, sendAt: r.sendAt ? new Date(r.sendAt) : null, status: r.status,
          },
          update: {
            recipientEmailHash: r.recipientEmailHash, recipientEmailCipher: r.recipientEmailCipher,
            message: r.message, sendAt: r.sendAt ? new Date(r.sendAt) : null,
          },
        });
      }
      return { ok: true, gifts: records };
    } catch {
      // fall through to file
    }
  }
  const all = await readStore();
  for (const r of records) {
    const idx = all.findIndex((g) => g.orderId === r.orderId && g.productId === r.productId);
    if (idx >= 0) all[idx] = { ...r, status: all[idx].status, sentAt: all[idx].sentAt };
    else all.push(r);
  }
  await writeStore(all);
  return { ok: true, gifts: records };
}

export async function listGifts(filter: { orderId?: string; status?: string } = {}): Promise<GiftRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.gift.findMany({
        where: { ...(filter.orderId ? { orderId: filter.orderId } : {}), ...(filter.status ? { status: filter.status } : {}) },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length > 0 || filter.orderId || filter.status) return rows.map(fromDb);
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  return all.filter(
    (g) => (!filter.orderId || g.orderId === filter.orderId) && (!filter.status || g.status === filter.status),
  );
}

async function updateGift(id: string, patch: Partial<Pick<GiftRecord, "status" | "sentAt">>): Promise<void> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.gift.update({
        where: { id },
        data: {
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt ? new Date(patch.sentAt) : null } : {}),
        },
      });
      return;
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  const idx = all.findIndex((g) => g.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...patch };
    await writeStore(all);
  }
}

// ─── Delivery ────────────────────────────────────────────────────────────────

/**
 * Deliver one gift to its recipient: links via the delivery
 * orchestrator's email channel (the always-available fallback), plus a
 * gift-note email carrying the buyer's message and a one-time claim
 * code for the social channels. Marks the gift sent/failed.
 */
export async function deliverGift(gift: GiftRecord): Promise<{ ok: boolean; via: string | null }> {
  const recipient = decryptPii(gift.recipientEmailCipher);
  if (!recipient) {
    await updateGift(gift.id, { status: "failed" });
    return { ok: false, via: null };
  }
  const product = getProductById(gift.productId);
  const outcome = await deliverOrder(
    { orderId: gift.orderId, email: recipient, productIds: [gift.productId] },
    "email",
  );
  const claim = await issueClaimCode({ orderId: gift.orderId, productIds: [gift.productId], channel: "email" });
  await sendEmail({
    to: recipient,
    kind: "gift",
    orderId: gift.orderId,
    subject: `You received a gift: ${product?.title ?? gift.productId}`,
    html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium Digitale Store</h1><p>Someone sent you <strong>${product?.title ?? gift.productId}</strong> as a gift.</p>${gift.message ? `<blockquote style="border-left:3px solid #b08d3c;padding-left:12px">${escapeHtml(gift.message)}</blockquote>` : ""}<p>Your download links are in the delivery email for order ${gift.orderId}. You can also claim them on our WhatsApp, Messenger or Instagram with this one-time code: <strong>${claim.code}</strong></p></div>`,
  });
  const ok = outcome.deliveredVia !== null;
  await updateGift(gift.id, { status: ok ? "sent" : "failed", sentAt: ok ? new Date().toISOString() : null });
  return { ok, via: outcome.deliveredVia };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Payment confirmed: transition the order's pending gifts — deliver the
 * immediate ones, schedule the dated ones — then send the buyer ONE
 * link-free confirmation. Returns what happened for logging.
 */
export async function processPaidOrderGifts(
  orderId: string,
  now: Date = new Date(),
): Promise<{ gifts: number; delivered: number; scheduled: number; confirmationSent: boolean }> {
  const gifts = await listGifts({ orderId });
  const pending = gifts.filter((g) => g.status === "pending");
  if (pending.length === 0) return { gifts: gifts.length, delivered: 0, scheduled: 0, confirmationSent: false };
  const { deliverNow, schedule } = planGiftActions(pending, now);
  let delivered = 0;
  for (const gift of schedule) await updateGift(gift.id, { status: "scheduled" });
  for (const gift of deliverNow) {
    const res = await deliverGift(gift);
    if (res.ok) delivered++;
  }
  const buyerEmail = pending[0].buyerEmail;
  await sendEmail({
    to: buyerEmail,
    kind: "gift-confirmation",
    orderId,
    subject: `Your Astralium gift order ${orderId} is confirmed`,
    html: giftBuyerConfirmationHtml({
      orderId,
      gifts: pending.map((g) => {
        const recipient = decryptPii(g.recipientEmailCipher);
        return {
          title: getProductById(g.productId)?.title ?? g.productId,
          recipientMasked: recipient ? maskEmail(recipient) : "***",
          sendAt: g.sendAt,
        };
      }),
    }),
  });
  return { gifts: gifts.length, delivered, scheduled: schedule.length, confirmationSent: true };
}

/** Cron job body: deliver scheduled gifts whose date has arrived. */
export async function runScheduledGiftJob(now: Date = new Date()): Promise<{ checked: number; due: number; delivered: number }> {
  const scheduled = await listGifts({ status: "scheduled" });
  const due = dueScheduledGifts(scheduled, now);
  let delivered = 0;
  for (const gift of due) {
    const res = await deliverGift(gift);
    if (res.ok) delivered++;
  }
  return { checked: scheduled.length, due: due.length, delivered };
}

/** Cleanup helper (tests). */
export async function deleteGiftsForOrder(orderId: string): Promise<void> {
  const all = await readStore();
  await writeStore(all.filter((g) => g.orderId !== orderId));
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.gift.deleteMany({ where: { orderId } });
    } catch {
      // nothing to clean
    }
  }
}
