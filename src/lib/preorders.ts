/**
 * Pre-orders (Phase 4, feature 14).
 *
 * Owner configuration (Setting "preorder_config" / .data/preorders.json):
 *   { [productId]: { releaseDate: "<ISO date>" } }
 *
 * A pre-order product is purchasable immediately. Delivery grants are
 * created at payment as usual, but the download route refuses to serve
 * the file until the release instant — the check is server-side in
 * /api/download, so a leaked link cannot beat the release. When the
 * release passes, the cron job (/api/jobs/preorder-releases) emails
 * every buyer that their download is now live; a notified-marker store
 * makes re-runs send nothing twice.
 */
import { getProductById } from "../data/products.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { getDb } from "./db.ts";
import { createDownloadToken } from "./tokens.ts";
import { sendEmail } from "../services/email.ts";

export type PreorderConfig = Record<string, { releaseDate: string }>;

const SETTING_KEY = "preorder_config";
const FILE = "preorders.json";
const NOTIFIED_KEY = "preorder_notified";
const NOTIFIED_FILE = "preorder-notified.json";

export function sanitizePreorderConfig(raw: unknown): PreorderConfig {
  if (!raw || typeof raw !== "object") return {};
  const out: PreorderConfig = {};
  for (const [pid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!getProductById(pid) || !v || typeof v !== "object") continue;
    const d = new Date(String((v as { releaseDate?: unknown }).releaseDate ?? ""));
    if (Number.isNaN(d.getTime())) continue;
    out[pid] = { releaseDate: d.toISOString() };
  }
  return out;
}

export async function getPreorderConfig(): Promise<PreorderConfig> {
  return getJsonConfig<PreorderConfig>(SETTING_KEY, FILE, sanitizePreorderConfig, {});
}

export async function setPreorderConfig(config: PreorderConfig): Promise<{ persisted: "db" | "file"; value: PreorderConfig }> {
  return setJsonConfig(SETTING_KEY, FILE, config, sanitizePreorderConfig);
}

/** Release instant for a product, or null when it is not a pre-order. */
export function releaseDateFor(config: PreorderConfig, productId: string): Date | null {
  const entry = config[productId];
  if (!entry) return null;
  const d = new Date(entry.releaseDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when the product may be downloaded at `now` (pure). */
export function isReleased(config: PreorderConfig, productId: string, now: Date = new Date()): boolean {
  const release = releaseDateFor(config, productId);
  if (!release) return true; // not a pre-order — downloads flow normally
  return now.getTime() >= release.getTime();
}

/** Server-side download gate used by /api/download. */
export async function downloadGate(
  productId: string,
  now: Date = new Date(),
): Promise<{ allowed: true } | { allowed: false; releaseDate: string }> {
  const config = await getPreorderConfig();
  const release = releaseDateFor(config, productId);
  if (!release || now.getTime() >= release.getTime()) return { allowed: true };
  return { allowed: false, releaseDate: release.toISOString() };
}

// ─── Release notification job ────────────────────────────────────────────────

export interface ReleaseOrderInput {
  orderId: string;
  email: string;
  status: string;
  productIds: string[];
}

/**
 * Which (order, product) pairs become deliverable at `now` and have not
 * been notified yet (pure). Only paid/fulfilled orders count.
 */
export function releasesDue(
  orders: ReleaseOrderInput[],
  config: PreorderConfig,
  notified: Set<string>,
  now: Date = new Date(),
): { orderId: string; email: string; productId: string; marker: string }[] {
  const due: { orderId: string; email: string; productId: string; marker: string }[] = [];
  for (const order of orders) {
    if (order.status !== "paid" && order.status !== "fulfilled") continue;
    for (const pid of new Set(order.productIds)) {
      const release = releaseDateFor(config, pid);
      if (!release || now.getTime() < release.getTime()) continue;
      const marker = `${order.orderId}:${pid}`;
      if (notified.has(marker)) continue;
      due.push({ orderId: order.orderId, email: order.email, productId: pid, marker });
    }
  }
  return due;
}

async function loadNotified(): Promise<Set<string>> {
  const raw = await getJsonConfig<string[]>(NOTIFIED_KEY, NOTIFIED_FILE, (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []), []);
  return new Set(raw);
}

async function saveNotified(set: Set<string>): Promise<void> {
  await setJsonConfig(NOTIFIED_KEY, NOTIFIED_FILE, [...set], (v) => (Array.isArray(v) ? v : []));
}

/**
 * Job body: email every buyer whose pre-order just released. Orders come
 * from the DB (the system of record for paid orders); without a DB there
 * is no buyer list, and the job honestly reports orders: 0.
 */
export async function runPreorderReleaseJob(now: Date = new Date()): Promise<{ orders: number; due: number; emailed: number; dbConfigured: boolean }> {
  const config = await getPreorderConfig();
  const db = await getDb().catch(() => null);
  if (!db) return { orders: 0, due: 0, emailed: 0, dbConfigured: false };
  const rows = await db.order.findMany({
    where: { status: { in: ["paid", "fulfilled"] } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
  const orders: ReleaseOrderInput[] = rows.map((o) => ({
    orderId: o.id, email: o.email, status: o.status, productIds: o.items.map((i) => i.productId),
  }));
  const notified = await loadNotified();
  const due = releasesDue(orders, config, notified, now);
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  let emailed = 0;
  for (const item of due) {
    const product = getProductById(item.productId);
    const url = `${base}/api/download/${createDownloadToken(item.productId, item.orderId)}`;
    await sendEmail({
      to: item.email,
      kind: "preorder-release",
      orderId: item.orderId,
      subject: `Now released: ${product?.title ?? item.productId} — your download is live`,
      html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium Digitale Store</h1><p>Your pre-order <strong>${product?.title ?? item.productId}</strong> (order ${item.orderId}) has been released.</p><p><a href="${url}">Download it now</a> — the link is personal and can be re-issued any time from your account page.</p></div>`,
    });
    emailed++;
    notified.add(item.marker);
  }
  if (due.length > 0) await saveNotified(notified);
  return { orders: orders.length, due: due.length, emailed, dbConfigured: true };
}
