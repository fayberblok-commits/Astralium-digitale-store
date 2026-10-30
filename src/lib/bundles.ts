/**
 * Owner bundles store (Phase 3, feature 3).
 *
 * Bundles persist to the DB Bundle table when configured, else to
 * .data/bundles.json (same pattern as bindings/versions). When NO stored
 * bundles exist, the storefront keeps using the file-catalog BUNDLES —
 * stored bundles replace them only once the owner creates one.
 *
 * Prices are never stored from client input: a stored bundle carries a
 * discountPercent and its price is derived from catalog prices via
 * computeBundlePrice (src/lib/byo.ts) at render/checkout time.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "./db.ts";
import { PRODUCTS, BUNDLES, type Bundle } from "../data/products.ts";
import { computeBundlePrice } from "./byo.ts";

export interface StoredBundle {
  id: string;
  title: string;
  description: string;
  productIds: string[];
  discountPercent: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "bundles.json");

async function readStore(): Promise<StoredBundle[]> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as StoredBundle[];
  } catch {
    return [];
  }
}

async function writeStore(list: StoredBundle[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

export async function listStoredBundles(): Promise<{ persisted: "db" | "file"; bundles: StoredBundle[] }> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.bundle.findMany({ orderBy: { createdAt: "asc" } });
      return {
        persisted: "db",
        bundles: rows.map((r) => ({
          id: r.id, title: r.title, description: r.description, productIds: r.productIds,
          discountPercent: r.discountPercent, active: r.active,
          createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
        })),
      };
    }
  } catch {
    // fall through to the JSON store
  }
  return { persisted: "file", bundles: await readStore() };
}

export async function saveStoredBundle(input: {
  id?: string;
  title: string;
  description?: string;
  productIds: string[];
  discountPercent: number;
  active?: boolean;
}): Promise<{ persisted: "db" | "file"; bundle: StoredBundle }> {
  const now = new Date().toISOString();
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const data = {
        title: input.title,
        description: input.description ?? "",
        productIds: input.productIds,
        discountPercent: input.discountPercent,
        active: input.active ?? true,
      };
      const row = input.id
        ? await db.bundle.update({ where: { id: input.id }, data })
        : await db.bundle.create({ data });
      return {
        persisted: "db",
        bundle: {
          id: row.id, title: row.title, description: row.description, productIds: row.productIds,
          discountPercent: row.discountPercent, active: row.active,
          createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        },
      };
    } catch {
      // fall through to file store
    }
  }
  const list = await readStore();
  const existing = input.id ? list.find((b) => b.id === input.id) : undefined;
  const bundle: StoredBundle = {
    id: existing?.id ?? `sb-${Date.now().toString(36)}`,
    title: input.title,
    description: input.description ?? "",
    productIds: input.productIds,
    discountPercent: input.discountPercent,
    active: input.active ?? existing?.active ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing ? list.map((b) => (b.id === bundle.id ? bundle : b)) : [...list, bundle];
  await writeStore(next);
  return { persisted: "file", bundle };
}

export async function deleteStoredBundle(id: string): Promise<{ persisted: "db" | "file"; deleted: boolean }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.bundle.delete({ where: { id } });
      return { persisted: "db", deleted: true };
    } catch {
      // fall through
    }
  }
  const list = await readStore();
  const next = list.filter((b) => b.id !== id);
  await writeStore(next);
  return { persisted: "file", deleted: next.length !== list.length };
}

/** Convert a stored bundle to the storefront Bundle shape (derived price). */
export function toStorefrontBundle(b: StoredBundle): Bundle {
  const { priceUSD } = computeBundlePrice(b.productIds, b.discountPercent, PRODUCTS);
  return {
    id: b.id,
    slug: b.id,
    title: b.title,
    description: b.description,
    productIds: b.productIds,
    priceUSD,
    hue: 43,
  };
}

/**
 * Storefront bundles: active stored bundles when the owner has created
 * any, otherwise the file-catalog bundles (unchanged Phase-1 behavior).
 */
export async function storefrontBundles(): Promise<Bundle[]> {
  const { bundles } = await listStoredBundles();
  const active = bundles.filter((b) => b.active);
  if (active.length === 0) return BUNDLES;
  return active.map(toStorefrontBundle);
}

/** Resolve a bundle id at checkout: stored bundles first, then catalog. */
export async function resolveBundle(id: string): Promise<Bundle | undefined> {
  const { bundles } = await listStoredBundles();
  const stored = bundles.find((b) => b.id === id && b.active);
  if (stored) return toStorefrontBundle(stored);
  return BUNDLES.find((b) => b.id === id);
}
