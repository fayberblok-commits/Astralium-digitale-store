/**
 * Smart search — PostgreSQL path (Phase 3, feature 6).
 *
 * Uses pg_trgm similarity over the synced Product table (extension +
 * GIN index created by the Phase-3 migration). Only product IDS cross
 * this boundary; ranking rows are rehydrated from the caller's catalog
 * pool — since the Phase 1 upgrade (F2) that pool is the resolved
 * storefront catalog (lib/catalog.ts: DB-first, file fallback), so a
 * title edited in the DB is what renders. Any failure (no DB, extension
 * missing, table not synced) returns null and the caller falls back to
 * the in-memory fuzzy search — search never hard-fails.
 */
import { getDb } from "./db.ts";
import { getProductById, type Product } from "../data/products.ts";

export async function searchProductsDb(query: string, limit = 48, pool?: Product[]): Promise<Product[] | null> {
  if (!query.trim()) return null;
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.$queryRawUnsafe<{ id: string; sim: number }[]>(
      `SELECT id, similarity(title, $1) AS sim
         FROM "Product"
        WHERE active = true AND (title % $1 OR title ILIKE '%' || $1 || '%')
        ORDER BY sim DESC
        LIMIT $2`,
      query,
      limit,
    );
    if (!rows || rows.length === 0) return null;
    const byId = pool ? new Map(pool.map((p) => [p.id, p])) : null;
    const products = rows
      .map((r) => (byId ? byId.get(r.id) : getProductById(r.id)))
      .filter((p): p is Product => Boolean(p));
    return products.length > 0 ? products : null;
  } catch {
    return null;
  }
}
