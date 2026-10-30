/**
 * Flash sales (Phase 4, feature 9).
 *
 * Campaigns are owner-configured (admin): a product set, a discount
 * percent, a start/end window and an optional quantity cap. The rules
 * that protect money:
 *
 *  - Prices are ALWAYS recomputed server-side from discountPercent and
 *    the catalog price — the client only ever sees the result.
 *  - The countdown target is the server-stored endsAt timestamp; the
 *    campaign state machine (scheduled → active → ended, plus
 *    sold-out / inactive) is a pure function of (campaign, now) and is
 *    unit-tested at every transition.
 *  - The quantity cap is enforced HERE at checkout: once soldCount
 *    reaches the cap the campaign stops discounting. Counting is
 *    idempotent per order (countedOrderIds), so a retried checkout for
 *    the same order never consumes the cap twice. Note the semantics:
 *    a unit is counted when its checkout session is created (a
 *    reservation), whether or not the customer completes payment.
 *
 * Persistence: FlashSale table when a DB is configured, else
 * .data/flash-sales.json (in the updated-file JSON fallback pattern).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getProductById, type Product } from "../data/products.ts";
import { round2 } from "./byo.ts";

export interface FlashSaleRecord {
  id: string;
  name: string;
  productIds: string[];
  discountPercent: number;
  startsAt: string; // ISO
  endsAt: string; // ISO
  quantityCap: number | null;
  soldCount: number;
  countedOrderIds: string[];
  active: boolean;
  createdAt: string; // ISO
}

export type CampaignState = "inactive" | "scheduled" | "active" | "sold-out" | "ended";

/** The campaign state machine — pure, every transition unit-tested. */
export function campaignState(sale: FlashSaleRecord, now: Date = new Date()): CampaignState {
  if (!sale.active) return "inactive";
  const t = now.getTime();
  if (t < new Date(sale.startsAt).getTime()) return "scheduled";
  if (t >= new Date(sale.endsAt).getTime()) return "ended";
  if (sale.quantityCap !== null && sale.soldCount >= sale.quantityCap) return "sold-out";
  return "active";
}

/** Discounted unit price for one product under a campaign (pure). */
export function flashUnitPrice(sale: FlashSaleRecord, product: Product): number {
  const pct = Math.min(90, Math.max(0, sale.discountPercent));
  return round2(product.priceUSD * (1 - pct / 100));
}

/**
 * The campaign currently discounting a product, if any: state must be
 * exactly "active" (scheduled/ended/sold-out campaigns never discount).
 * When several overlap, the deepest discount wins.
 */
export function activeSaleForProduct(
  sales: FlashSaleRecord[],
  productId: string,
  now: Date = new Date(),
): FlashSaleRecord | undefined {
  return sales
    .filter((s) => s.productIds.includes(productId) && campaignState(s, now) === "active")
    .sort((a, b) => b.discountPercent - a.discountPercent)[0];
}

export interface FlashPrice {
  productId: string;
  saleId: string;
  fullPriceUSD: number;
  priceUSD: number;
}

/** Server-side price resolution for a set of products (pure). */
export function resolveFlashPrices(
  sales: FlashSaleRecord[],
  productIds: string[],
  catalog: (id: string) => Product | undefined,
  now: Date = new Date(),
): Map<string, FlashPrice> {
  const out = new Map<string, FlashPrice>();
  for (const pid of new Set(productIds)) {
    const product = catalog(pid);
    if (!product) continue;
    const sale = activeSaleForProduct(sales, pid, now);
    if (!sale) continue;
    out.set(pid, {
      productId: pid,
      saleId: sale.id,
      fullPriceUSD: product.priceUSD,
      priceUSD: flashUnitPrice(sale, product),
    });
  }
  return out;
}

// ─── Persistence (DB → .data fallback) ──────────────────────────────────────

const STORE_PATH = path.join(process.cwd(), ".data", "flash-sales.json");

async function readStore(): Promise<FlashSaleRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as FlashSaleRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeStore(list: FlashSaleRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

interface DbFlashSale {
  id: string; name: string; productIds: string[]; discountPercent: number;
  startsAt: Date; endsAt: Date; quantityCap: number | null; soldCount: number;
  countedOrderIds: string[]; active: boolean; createdAt: Date;
}

function fromDb(r: DbFlashSale): FlashSaleRecord {
  return {
    id: r.id, name: r.name, productIds: r.productIds, discountPercent: r.discountPercent,
    startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(),
    quantityCap: r.quantityCap, soldCount: r.soldCount, countedOrderIds: r.countedOrderIds,
    active: r.active, createdAt: r.createdAt.toISOString(),
  };
}

export async function listFlashSales(): Promise<FlashSaleRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.flashSale.findMany({ orderBy: { startsAt: "asc" } });
      if (rows.length > 0) return rows.map(fromDb);
    }
  } catch {
    // fall through
  }
  return readStore();
}

export interface FlashSaleInput {
  id?: string;
  name: string;
  productIds: string[];
  discountPercent: number;
  startsAt: string;
  endsAt: string;
  quantityCap?: number | null;
  active?: boolean;
}

export function sanitizeFlashSaleInput(input: FlashSaleInput): FlashSaleRecord | null {
  const productIds = [...new Set((input.productIds ?? []).filter((id) => getProductById(id)))];
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (productIds.length === 0 || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (endsAt.getTime() <= startsAt.getTime()) return null;
  const cap = input.quantityCap === null || input.quantityCap === undefined ? null : Math.max(1, Math.floor(input.quantityCap));
  return {
    id: input.id ?? randomUUID(),
    name: String(input.name ?? "Flash sale").slice(0, 80) || "Flash sale",
    productIds,
    discountPercent: Math.min(90, Math.max(1, Math.floor(input.discountPercent) || 0)),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    quantityCap: cap,
    soldCount: 0,
    countedOrderIds: [],
    active: input.active !== false,
    createdAt: new Date().toISOString(),
  };
}

export async function saveFlashSale(input: FlashSaleInput): Promise<{ ok: boolean; sale?: FlashSaleRecord; persisted?: "db" | "file"; error?: string }> {
  const clean = sanitizeFlashSaleInput(input);
  if (!clean) return { ok: false, error: "INVALID_CAMPAIGN" };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const existing = input.id ? await db.flashSale.findUnique({ where: { id: input.id } }) : null;
      const data = {
        name: clean.name, productIds: clean.productIds, discountPercent: clean.discountPercent,
        startsAt: new Date(clean.startsAt), endsAt: new Date(clean.endsAt),
        quantityCap: clean.quantityCap, active: clean.active,
      };
      const row = existing
        ? await db.flashSale.update({ where: { id: existing.id }, data })
        : await db.flashSale.create({ data: { id: clean.id, ...data } });
      return { ok: true, sale: fromDb(row), persisted: "db" };
    } catch {
      // fall through to file
    }
  }
  const all = await readStore();
  const idx = all.findIndex((s) => s.id === clean.id);
  // Preserve counters on update — an edit must never reset sales.
  const merged = idx >= 0 ? { ...clean, soldCount: all[idx].soldCount, countedOrderIds: all[idx].countedOrderIds, createdAt: all[idx].createdAt } : clean;
  if (idx >= 0) all[idx] = merged; else all.push(merged);
  await writeStore(all);
  return { ok: true, sale: merged, persisted: "file" };
}

export async function deleteFlashSale(id: string): Promise<void> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.flashSale.delete({ where: { id } });
      return;
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  await writeStore(all.filter((s) => s.id !== id));
}

/**
 * Count an order's units against a campaign cap — idempotent per order:
 * calling twice with the same orderId changes nothing. Returns the
 * campaign's soldCount after the operation.
 */
export async function countFlashSaleOrder(saleId: string, orderId: string, units: number): Promise<number> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.flashSale.findUnique({ where: { id: saleId } });
      if (!row) return 0;
      if (row.countedOrderIds.includes(orderId)) return row.soldCount;
      const updated = await db.flashSale.update({
        where: { id: saleId },
        data: { soldCount: row.soldCount + Math.max(0, units), countedOrderIds: [...row.countedOrderIds, orderId] },
      });
      return updated.soldCount;
    } catch {
      // fall through
    }
  }
  const all = await readStore();
  const sale = all.find((s) => s.id === saleId);
  if (!sale) return 0;
  if (sale.countedOrderIds.includes(orderId)) return sale.soldCount;
  sale.soldCount += Math.max(0, units);
  sale.countedOrderIds.push(orderId);
  await writeStore(all);
  return sale.soldCount;
}
