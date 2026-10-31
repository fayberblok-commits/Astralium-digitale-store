/**
 * Wishlist sharing + price-drop alerts (Phase 3, feature 8).
 *
 * Share links encode product SLUGS in the URL — no account, no PII:
 *   /[locale]/wishlist/shared?items=slug-one,slug-two
 * parseShareItems validates every slug against the catalog.
 *
 * Price-drop alerts are explicit opt-in only. The email is stored as
 * AES-256-GCM ciphertext (src/lib/pii.ts) + SHA-256 hash — registration
 * is refused when PII encryption is not configured, because plaintext
 * email storage is never acceptable. The cron job compares the saved
 * price snapshot against the CURRENT catalog price and emails only on
 * an actual drop; after emailing, the snapshot moves to the new price
 * so a repeat run never re-sends the same drop.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { PRODUCTS } from "../data/products.ts";
import { encryptPii, decryptPii, hashSubject, piiConfigured } from "./pii.ts";
import { sendEmail } from "../services/email.ts";

// ─── Share links (pure, client-safe) live in src/lib/share.ts ───────────────

export { encodeShareItems, parseShareItems } from "./share.ts";

// ─── Price-drop detection (pure) ─────────────────────────────────────────────

export interface AlertSnapshot {
  id: string;
  productId: string;
  priceAtSave: number;
}

export interface PriceDrop {
  alertId: string;
  productId: string;
  fromUSD: number;
  toUSD: number;
}

/** A drop is strictly: current price LOWER than the saved snapshot. */
export function findPriceDrops(
  snapshots: AlertSnapshot[],
  currentPrice: (productId: string) => number | undefined,
): PriceDrop[] {
  const drops: PriceDrop[] = [];
  for (const s of snapshots) {
    const now = currentPrice(s.productId);
    if (now === undefined) continue;
    if (now < s.priceAtSave) {
      drops.push({ alertId: s.id, productId: s.productId, fromUSD: s.priceAtSave, toUSD: now });
    }
  }
  return drops;
}

// ─── Alert store (DB → .data fallback) ───────────────────────────────────────

export interface WishlistAlertRecord extends AlertSnapshot {
  emailHash: string;
  emailCipher: string;
  createdAt: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "wishlist-alerts.json");

async function readStore(): Promise<WishlistAlertRecord[]> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as WishlistAlertRecord[];
  } catch {
    return [];
  }
}

async function writeStore(list: WishlistAlertRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

export async function listAlerts(): Promise<WishlistAlertRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.wishlistAlert.findMany();
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id, emailHash: r.emailHash, emailCipher: r.emailCipher,
          productId: r.productId, priceAtSave: r.priceAtSave, createdAt: r.createdAt.toISOString(),
        }));
      }
    }
  } catch {
    // fall through
  }
  return readStore();
}

export async function registerAlert(input: {
  email: string;
  productId: string;
  optIn: boolean;
}): Promise<{ ok: boolean; error?: string; persisted?: "db" | "file" }> {
  if (input.optIn !== true) return { ok: false, error: "OPTIN_REQUIRED" };
  const product = PRODUCTS.find((p) => p.id === input.productId);
  if (!product) return { ok: false, error: "PRODUCT_NOT_FOUND" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return { ok: false, error: "INVALID_EMAIL" };
  if (!piiConfigured()) return { ok: false, error: "PII_NOT_CONFIGURED" };
  const emailHash = hashSubject(input.email.trim().toLowerCase());
  const emailCipher = encryptPii(input.email.trim().toLowerCase());
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const productRow = await db.product.findUnique({ where: { id: product.id } });
      if (productRow) {
        await db.wishlistAlert.upsert({
          where: { emailHash_productId: { emailHash, productId: product.id } },
          create: { emailHash, emailCipher, productId: product.id, priceAtSave: product.priceUSD },
          update: { emailCipher, priceAtSave: product.priceUSD },
        });
        return { ok: true, persisted: "db" };
      }
    } catch {
      // fall through to file store
    }
  }
  const all = await readStore();
  const existing = all.find((a) => a.emailHash === emailHash && a.productId === product.id);
  const record: WishlistAlertRecord = {
    id: existing?.id ?? randomUUID(),
    emailHash, emailCipher, productId: product.id,
    priceAtSave: product.priceUSD, createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await writeStore(existing ? all.map((a) => (a.id === record.id ? record : a)) : [...all, record]);
  return { ok: true, persisted: "file" };
}

async function updateSnapshotPrice(id: string, newPrice: number): Promise<void> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.wishlistAlert.update({ where: { id }, data: { priceAtSave: newPrice } });
      return;
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  await writeStore(all.map((a) => (a.id === id ? { ...a, priceAtSave: newPrice } : a)));
}

/** Cron job body: compare snapshots vs catalog, email actual drops. */
export async function runPriceDropJob(): Promise<{ checked: number; drops: number; emailed: number }> {
  const alerts = await listAlerts();
  const byId = new Map(alerts.map((a) => [a.id, a]));
  const drops = findPriceDrops(alerts, (pid) => PRODUCTS.find((p) => p.id === pid)?.priceUSD);
  let emailed = 0;
  for (const drop of drops) {
    const alert = byId.get(drop.alertId);
    if (!alert) continue;
    const email = decryptPii(alert.emailCipher);
    if (!email) continue;
    const product = PRODUCTS.find((p) => p.id === drop.productId);
    await sendEmail({
      to: email,
      kind: "price-alert",
      subject: `Price drop: ${product?.title ?? drop.productId} is now $${drop.toUSD.toFixed(2)}`,
      html: `<div style="font-family:Georgia,serif;color:#10131f"><h1>Astralium Digitale Store</h1><p>Good news — <strong>${product?.title ?? drop.productId}</strong> from your wishlist dropped from $${drop.fromUSD.toFixed(2)} to <strong>$${drop.toUSD.toFixed(2)}</strong>.</p></div>`,
    });
    emailed++;
    // Move the snapshot so the same drop is never emailed twice.
    await updateSnapshotPrice(alert.id, drop.toUSD);
  }
  return { checked: alerts.length, drops: drops.length, emailed };
}
