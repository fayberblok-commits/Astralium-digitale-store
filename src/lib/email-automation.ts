/**
 * Email automation (Phase 5, feature 20). Flag `email_automation` —
 * default OFF (it sends email; the owner enables it deliberately).
 *
 * Three automations, all triggered by the cron-secret job endpoint
 * (POST /api/jobs/email-automation), all mock-testable via an injectable
 * sender:
 *
 *  1. Abandoned-cart recovery — the checkout page captures a cart
 *     snapshot (email as hash + AES-256-GCM ciphertext ONLY, items +
 *     server-computed total, recovery token stored HASHED). After 1h an
 *     open snapshot earns one recovery email with a signed link back to
 *     the cart; opening the link restores the items and closes it.
 *  2. Review request — 3 days after a paid order (DB), one email per
 *     order linking to the product pages (Phase-3 reviews). A sent-mark
 *     store makes replays no-ops. Without a DB there are no persisted
 *     orders, so the job honestly reports orders: 0.
 *  3. Win-back — buyers whose last order is 30+ days old, at most once
 *     per 90 days per buyer.
 *
 * EVERY automated email carries a List-Unsubscribe header (with the
 * RFC 8058 one-click POST) and an unsubscribe link in the body. The
 * one-click endpoint records a ConsentRecord (granted=false, channel
 * "email") and every send checks isOptedOut first — an unsubscribed
 * address is never emailed again by any automation.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "./db.ts";
import { getProductById } from "../data/products.ts";
import { decryptPii, encryptPii, hashSubject, isOptedOut, piiConfigured, recordConsent } from "./pii.ts";
import { hashEmail } from "./reviews.ts";
import { sendEmail, type EmailMessage } from "../services/email.ts";

/** Same base-URL rule as lib/server.ts, without pulling next/headers
 * into this module (keeps the automation jobs unit-testable under
 * plain node --test, like the delivery orchestrator). */
function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

// ─── Signed automation tokens (recovery + unsubscribe) ───────────────────────

function tokenSecret(): string {
  return process.env.DOWNLOAD_SIGNING_SECRET || "dev-only-insecure-signing-secret-change-me-0123456789";
}

function signPayload(body: string, purpose: string): string {
  return createHmac("sha256", tokenSecret()).update(`${purpose}.${body}`).digest("base64url");
}

export function createAutomationToken(payload: Record<string, unknown>, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signPayload(body, purpose)}`;
}

export function verifyAutomationToken<T extends Record<string, unknown>>(
  token: string,
  purpose: string,
  nowSeconds?: number,
): (T & { exp: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = signPayload(body, purpose);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number") return null;
    if (payload.exp < (nowSeconds ?? Math.floor(Date.now() / 1000))) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ─── Unsubscribe ─────────────────────────────────────────────────────────────

export function unsubscribeTokenFor(email: string): string {
  return createAutomationToken(
    { e: email.trim().toLowerCase(), exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600 },
    "unsubscribe",
  );
}

export function unsubscribeUrl(email: string): string {
  return `${siteUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubscribeTokenFor(email))}`;
}

/** RFC 2369 + RFC 8058 headers attached to EVERY automated email. */
export function listUnsubscribeHeaders(email: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl(email)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function handleUnsubscribe(token: string): Promise<{ ok: boolean; email?: string }> {
  const payload = verifyAutomationToken<{ e: string }>(token, "unsubscribe");
  if (!payload?.e) return { ok: false };
  await recordConsent({ subject: payload.e, channel: "email", granted: false, storeCipher: false });
  return { ok: true, email: payload.e };
}

// ─── Cart snapshots ──────────────────────────────────────────────────────────

export interface SnapshotItem {
  productId: string;
  title: string;
  priceUSD: number;
}

export interface CartSnapshotRecord {
  id: string;
  emailHash: string;
  emailCipher: string;
  items: SnapshotItem[];
  totalUSD: number;
  locale: string;
  status: "open" | "recovered";
  recoveryTokenHash: string;
  recoverySentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SNAPSHOT_PATH = path.join(process.cwd(), ".data", "cart-snapshots.json");

async function readSnapshots(): Promise<CartSnapshotRecord[]> {
  try {
    return JSON.parse(await fs.readFile(SNAPSHOT_PATH, "utf8")) as CartSnapshotRecord[];
  } catch {
    return [];
  }
}

async function writeSnapshots(list: CartSnapshotRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(list, null, 2), "utf8");
}

type SnapshotRow = {
  id: string; emailHash: string; emailCipher: string; items: unknown; totalUSD: number;
  locale: string; status: string; recoveryTokenHash: string; recoverySentAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

function snapshotFromRow(r: SnapshotRow): CartSnapshotRecord {
  return {
    id: r.id, emailHash: r.emailHash, emailCipher: r.emailCipher,
    items: Array.isArray(r.items) ? (r.items as SnapshotItem[]) : [],
    totalUSD: r.totalUSD, locale: r.locale,
    status: r.status === "recovered" ? "recovered" : "open",
    recoveryTokenHash: r.recoveryTokenHash,
    recoverySentAt: r.recoverySentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

async function saveSnapshot(rec: CartSnapshotRecord): Promise<"db" | "file"> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const items = JSON.parse(JSON.stringify(rec.items)) as import("@prisma/client").Prisma.InputJsonValue;
      await db.cartSnapshot.upsert({
        where: { id: rec.id },
        create: {
          id: rec.id, emailHash: rec.emailHash, emailCipher: rec.emailCipher, items,
          totalUSD: rec.totalUSD, locale: rec.locale, status: rec.status,
          recoveryTokenHash: rec.recoveryTokenHash,
          recoverySentAt: rec.recoverySentAt ? new Date(rec.recoverySentAt) : null,
        },
        update: {
          items, totalUSD: rec.totalUSD, status: rec.status,
          recoveryTokenHash: rec.recoveryTokenHash,
          recoverySentAt: rec.recoverySentAt ? new Date(rec.recoverySentAt) : null,
        },
      });
      return "db";
    } catch { /* fall through */ }
  }
  const all = await readSnapshots();
  const idx = all.findIndex((s) => s.id === rec.id);
  if (idx >= 0) all[idx] = rec; else all.push(rec);
  await writeSnapshots(all);
  return "file";
}

export function snapshotItemsFor(productIds: string[]): SnapshotItem[] | null {
  const items: SnapshotItem[] = [];
  for (const pid of new Set(productIds)) {
    const p = getProductById(pid);
    if (!p) return null;
    items.push({ productId: p.id, title: p.title, priceUSD: p.priceUSD });
  }
  return items.length > 0 ? items : null;
}

export type CaptureResult =
  | { ok: true; snapshot: CartSnapshotRecord; recoveryToken: string; persisted: "db" | "file" }
  | { ok: false; error: "PII_NOT_CONFIGURED" | "INVALID_ITEMS" | "INVALID_EMAIL" };

/**
 * Capture (or refresh) an abandoned-cart snapshot. A fresh recovery
 * token is minted on every capture — older links die, by design.
 */
export async function captureCartSnapshot(input: {
  email: string;
  productIds: string[];
  locale?: string;
}): Promise<CaptureResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "INVALID_EMAIL" };
  if (!piiConfigured()) return { ok: false, error: "PII_NOT_CONFIGURED" };
  const items = snapshotItemsFor(input.productIds);
  if (!items) return { ok: false, error: "INVALID_ITEMS" };
  const emailHash = hashEmail(email);
  const itemsKey = items.map((i) => i.productId).sort().join(",");
  const all = await readSnapshots();
  let existing: CartSnapshotRecord | undefined;
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.cartSnapshot.findMany({
        where: { emailHash, status: "open" },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      existing = rows.map(snapshotFromRow).find(
        (s) => s.items.map((i) => i.productId).sort().join(",") === itemsKey,
      );
    } catch { /* fall through */ }
  }
  if (!existing) {
    existing = all.find(
      (s) => s.emailHash === emailHash && s.status === "open" &&
        s.items.map((i) => i.productId).sort().join(",") === itemsKey,
    );
  }
  const snapshotId = existing?.id ?? randomUUID();
  const recoveryToken = createAutomationToken(
    { sid: snapshotId, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, n: randomBytes(4).toString("hex") },
    "cart-recovery",
  );
  const now = new Date().toISOString();
  const rec: CartSnapshotRecord = {
    id: snapshotId,
    emailHash,
    emailCipher: encryptPii(email),
    items,
    totalUSD: Math.round(items.reduce((s, i) => s + i.priceUSD, 0) * 100) / 100,
    locale: (input.locale ?? "en").slice(0, 10),
    status: "open",
    recoveryTokenHash: hashToken(recoveryToken),
    recoverySentAt: existing?.recoverySentAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const persisted = await saveSnapshot(rec);
  return { ok: true, snapshot: rec, recoveryToken, persisted };
}

export async function findSnapshotByTokenHash(tokenHash: string): Promise<CartSnapshotRecord | null> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.cartSnapshot.findUnique({ where: { recoveryTokenHash: tokenHash } });
      if (row) return snapshotFromRow(row);
    } catch { /* fall through */ }
  }
  return (await readSnapshots()).find((s) => s.recoveryTokenHash === tokenHash) ?? null;
}

/** Resolve a recovery link: verifies signature + expiry + stored hash. */
export async function resolveRecoveryToken(token: string): Promise<CartSnapshotRecord | null> {
  const payload = verifyAutomationToken<{ sid: string }>(token, "cart-recovery");
  if (!payload?.sid) return null;
  const snap = await findSnapshotByTokenHash(hashToken(token));
  if (!snap || snap.id !== payload.sid || snap.status !== "open") return null;
  return snap;
}

export async function markSnapshotRecovered(id: string): Promise<void> {
  const all = await readSnapshots();
  const fromFile = all.find((s) => s.id === id);
  if (fromFile) {
    await saveSnapshot({ ...fromFile, status: "recovered", updatedAt: new Date().toISOString() });
    return;
  }
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.cartSnapshot.findUnique({ where: { id } });
      if (row) {
        await saveSnapshot({ ...snapshotFromRow(row), status: "recovered", updatedAt: new Date().toISOString() });
      }
    } catch { /* nothing to mark */ }
  }
}

export async function listOpenSnapshots(): Promise<CartSnapshotRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.cartSnapshot.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, take: 500 });
      if (rows.length > 0) return rows.map(snapshotFromRow);
    } catch { /* fall through */ }
  }
  return (await readSnapshots()).filter((s) => s.status === "open");
}

// ─── Sent markers (idempotency for review / win-back sends) ──────────────────

const MARKS_PATH = path.join(process.cwd(), ".data", "email-automation-marks.json");
type Marks = Record<string, string>; // key → ISO timestamp

async function readMarks(): Promise<Marks> {
  try {
    const db = await getDb();
    if (db) {
      const row = await db.setting.findUnique({ where: { key: "email_automation_marks" } });
      if (row && row.value && typeof row.value === "object") return row.value as Marks;
    }
  } catch { /* fall through */ }
  try {
    return JSON.parse(await fs.readFile(MARKS_PATH, "utf8")) as Marks;
  } catch {
    return {};
  }
}

async function writeMarks(marks: Marks): Promise<void> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const value = JSON.parse(JSON.stringify(marks)) as import("@prisma/client").Prisma.InputJsonValue;
      await db.setting.upsert({
        where: { key: "email_automation_marks" },
        create: { key: "email_automation_marks", value },
        update: { value },
      });
      return;
    } catch { /* fall through */ }
  }
  await fs.mkdir(path.dirname(MARKS_PATH), { recursive: true });
  await fs.writeFile(MARKS_PATH, JSON.stringify(marks, null, 2), "utf8");
}

// ─── Sending (opt-out checked, headers attached) ─────────────────────────────

export type AutomationSender = (msg: EmailMessage) => Promise<{ delivered: boolean; provider: string }>;

export async function sendAutomated(
  input: { to: string; subject: string; kind: EmailMessage["kind"]; html: string; orderId?: string },
  send: AutomationSender = sendEmail,
): Promise<{ sent: boolean; reason?: string }> {
  if (await isOptedOut(input.to, "email")) return { sent: false, reason: "OPTED_OUT" };
  const unsub = unsubscribeUrl(input.to);
  const html = `${input.html}<p style="color:#666;font-size:12px">You receive this because you shopped at Astralium Digitale Store. <a href="${unsub}">Unsubscribe</a> from automated emails at any time.</p>`;
  const res = await send({
    to: input.to,
    subject: input.subject,
    kind: input.kind,
    html,
    orderId: input.orderId,
    headers: listUnsubscribeHeaders(input.to),
  });
  return { sent: true, reason: res.delivered ? undefined : `QUEUED:${res.provider}` };
}

// ─── Email bodies ────────────────────────────────────────────────────────────

const shell = (inner: string) =>
  `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium Digitale Store</h1>${inner}</div>`;

export function recoveryEmailHtml(snapshot: CartSnapshotRecord, recoveryUrl: string): string {
  const rows = snapshot.items.map((i) => `<tr><td style="padding:8px 0">${i.title}</td><td>$${i.priceUSD.toFixed(2)}</td></tr>`).join("");
  return shell(
    `<p>Your cart is waiting for you — everything in it is digital, so checkout takes under two minutes and delivery is instant.</p><table>${rows}</table><p><a href="${recoveryUrl}">Return to your cart</a> — total $${snapshot.totalUSD.toFixed(2)}.</p>`,
  );
}

export function reviewRequestEmailHtml(params: { orderId: string; items: { title: string; url: string }[] }): string {
  const rows = params.items
    .map((i) => `<tr><td style="padding:8px 0">${i.title}</td><td><a href="${i.url}">Write a review</a></td></tr>`)
    .join("");
  return shell(
    `<p>Thank you for order <strong>${params.orderId}</strong>. A short review helps other readers and listeners choose well — it takes a minute.</p><table>${rows}</table>`,
  );
}

export function winbackEmailHtml(shopUrl: string): string {
  return shell(
    `<p>It has been a while — new ebooks, courses and audio have landed since your last visit.</p><p><a href="${shopUrl}">Browse what's new</a></p>`,
  );
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export const RECOVERY_AFTER_MS = 1 * 3600 * 1000;
export const REVIEW_AFTER_MS = 3 * 24 * 3600 * 1000;
export const WINBACK_AFTER_MS = 30 * 24 * 3600 * 1000;
export const WINBACK_INTERVAL_MS = 90 * 24 * 3600 * 1000;

/** Which open snapshots are due a recovery email (pure). */
export function dueRecoverySnapshots(snapshots: CartSnapshotRecord[], now = new Date()): CartSnapshotRecord[] {
  return snapshots.filter(
    (s) => s.status === "open" && s.recoverySentAt === null &&
      now.getTime() - new Date(s.createdAt).getTime() >= RECOVERY_AFTER_MS,
  );
}

export interface AutomationSummary {
  recovery: { considered: number; sent: number; skippedOptOut: number };
  reviewRequests: { orders: number; sent: number; skippedOptOut: number };
  winback: { buyers: number; sent: number; skippedOptOut: number };
  dbConfigured: boolean;
}

export async function runEmailAutomationJobs(
  opts: { now?: Date; send?: AutomationSender } = {},
): Promise<AutomationSummary> {
  const now = opts.now ?? new Date();
  const send = opts.send ?? sendEmail;
  const summary: AutomationSummary = {
    recovery: { considered: 0, sent: 0, skippedOptOut: 0 },
    reviewRequests: { orders: 0, sent: 0, skippedOptOut: 0 },
    winback: { buyers: 0, sent: 0, skippedOptOut: 0 },
    dbConfigured: false,
  };

  // 1) Abandoned-cart recovery (works with or without a DB).
  const open = await listOpenSnapshots();
  const due = dueRecoverySnapshots(open, now);
  summary.recovery.considered = due.length;
  for (const snap of due) {
    const email = decryptPii(snap.emailCipher);
    if (!email) continue;
    const token = createAutomationToken(
      { sid: snap.id, exp: Math.floor(now.getTime() / 1000) + 7 * 24 * 3600, n: randomBytes(4).toString("hex") },
      "cart-recovery",
    );
    const refreshed: CartSnapshotRecord = {
      ...snap,
      recoveryTokenHash: hashToken(token),
      recoverySentAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const res = await sendAutomated(
      {
        to: email,
        subject: "Your Astralium cart is waiting",
        kind: "abandoned-cart",
        html: recoveryEmailHtml(snap, `${siteUrl()}/${snap.locale}/cart?recover=${encodeURIComponent(token)}`),
      },
      send,
    );
    if (res.reason === "OPTED_OUT") { summary.recovery.skippedOptOut++; continue; }
    await saveSnapshot(refreshed);
    summary.recovery.sent++;
  }

  // 2) + 3) need persisted orders — DB only, reported honestly.
  const db = await getDb().catch(() => null);
  if (!db) return summary;
  summary.dbConfigured = true;
  const marks = await readMarks();
  let marksDirty = false;

  const orders = await db.order.findMany({
    where: { status: { in: ["paid", "fulfilled"] } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
  summary.reviewRequests.orders = orders.length;

  for (const order of orders) {
    const key = `review:${order.id}`;
    if (marks[key]) continue;
    if (now.getTime() - order.createdAt.getTime() < REVIEW_AFTER_MS) continue;
    const items = order.items
      .map((it) => getProductById(it.productId))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ title: p.title, url: `${siteUrl()}/en/product/${p.slug}` }));
    if (items.length === 0) continue;
    const res = await sendAutomated(
      { to: order.email, subject: "How was your Astralium order?", kind: "review-request", html: reviewRequestEmailHtml({ orderId: order.id, items }), orderId: order.id },
      send,
    );
    if (res.reason === "OPTED_OUT") { summary.reviewRequests.skippedOptOut++; continue; }
    marks[key] = now.toISOString();
    marksDirty = true;
    summary.reviewRequests.sent++;
  }

  // Win-back: last order per buyer at least WINBACK_AFTER old.
  const lastByEmail = new Map<string, Date>();
  for (const order of orders) {
    const prev = lastByEmail.get(order.email);
    if (!prev || order.createdAt > prev) lastByEmail.set(order.email, order.createdAt);
  }
  for (const [email, lastAt] of lastByEmail) {
    if (now.getTime() - lastAt.getTime() < WINBACK_AFTER_MS) continue;
    summary.winback.buyers++;
    const key = `winback:${hashEmail(email)}`;
    const lastSent = marks[key] ? new Date(marks[key]).getTime() : 0;
    if (now.getTime() - lastSent < WINBACK_INTERVAL_MS) continue;
    const res = await sendAutomated(
      { to: email, subject: "New at Astralium since your last visit", kind: "win-back", html: winbackEmailHtml(`${siteUrl()}/en/shop`) },
      send,
    );
    if (res.reason === "OPTED_OUT") { summary.winback.skippedOptOut++; continue; }
    marks[key] = now.toISOString();
    marksDirty = true;
    summary.winback.sent++;
  }

  if (marksDirty) await writeMarks(marks);
  return summary;
}

/** Test helper: expose the subject-hash helper used for win-back marks. */
export const __hashSubject = hashSubject;
