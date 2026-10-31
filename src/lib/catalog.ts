/**
 * Storefront catalog (Phase 1 upgrade, foundation F2).
 *
 * The database is the storefront's single source of truth WHEN
 * DATABASE_URL is set AND PostgreSQL is actually reachable:
 * home / shop / product / search read through this module, and admin
 * product edits land in the Product table (or, in zero-DB mode, in the
 * .data/catalog-overrides.json overlay) and show on the storefront
 * without any file change.
 *
 * Fallback contract (never break the zero-env run or the live site):
 * when the DB is unset — or set but unreachable — the typed file
 * catalog (src/data/products.ts) serves as bootstrap seed + fallback,
 * and a loud warning is logged whenever DATABASE_URL is set but the
 * database cannot be reached. Reachability is probed with a short
 * timeout and cached; resolutions are cached for a few seconds.
 *
 * Merge rule for DB rows: commercial fields (title, priceUSD, slug,
 * active) are always authoritative. Editorial fields fall back to the
 * seed per-field while a row is unpopulated (legacy rows created by
 * the old title/price-only sync); the bootstrap pass heals such rows
 * by writing the seed's editorial fields into the DB (never touching
 * title/price/fileKey, which may be owner data).
 */
import { CATEGORIES, PRODUCTS, getProductById, type CategoryId, type Product } from "../data/products.ts";
import { getDb, isDbConfigured } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { Prisma } from "@prisma/client";

export type CatalogSource = "db" | "file";

const RESOLUTION_TTL_MS = 15_000;
const PROBE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 1_500;

interface Resolution {
  products: Product[]; // active only — the storefront view
  all: Product[]; // including inactive — the admin view
  source: CatalogSource;
  at: number;
}

let cached: Resolution | null = null;
let inflight: Promise<Resolution> | null = null;
let probeCache: { ok: boolean; at: number } | null = null;
let bootstrapped = false;

export function invalidateCatalogCache(): void {
  cached = null;
  probeCache = null;
}

// ─── DB reachability probe ───────────────────────────────────────────────────

async function dbReachable(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.ok;
  let ok = false;
  try {
    const db = await getDb();
    if (db) {
      const probe = db.$queryRaw`SELECT 1`;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe-timeout")), PROBE_TIMEOUT_MS),
      );
      await Promise.race([probe, timeout]);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    console.error(
      "[astralium] WARNING: DATABASE_URL is set but PostgreSQL is unreachable — " +
        "the storefront is serving the FILE catalog fallback, NOT the database. " +
        "Check DATABASE_URL / database availability.",
    );
  }
  probeCache = { ok, at: Date.now() };
  return ok;
}

// ─── Row → Product merge ─────────────────────────────────────────────────────

type DbProductRow = {
  id: string; slug: string; title: string; priceUSD: number;
  fileKey: string | null; previewKey: string | null; version: string; active: boolean;
  subtitle: string; description: string; category: string; formats: unknown;
  compareAtUSD: number | null; rating: number; reviewsCount: number; badge: string | null;
  includes: unknown; preview: string; hue: number; publishedAt: string; language: string | null;
  costUSD?: number; publishAt?: string | null; priceOverrides?: unknown; translations?: unknown;
  createdAt: Date;
};

/** Sanitize a per-currency price-override map ({ EUR: 21.5 }). */
export function asPriceOverrides(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const code = k.toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && typeof val === "number" && Number.isFinite(val) && val >= 0) {
      out[code] = Math.round(val * 100) / 100;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Sanitize per-locale product translations. */
export function asTranslations(v: unknown): Product["translations"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: NonNullable<Product["translations"]> = {};
  for (const [locale, fields] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(locale) || !fields || typeof fields !== "object") continue;
    const f = fields as Record<string, unknown>;
    const entry: { title?: string; subtitle?: string; description?: string } = {};
    if (typeof f.title === "string" && f.title.trim()) entry.title = f.title.slice(0, 200);
    if (typeof f.subtitle === "string") entry.subtitle = f.subtitle.slice(0, 300);
    if (typeof f.description === "string") entry.description = f.description.slice(0, 5000);
    if (Object.keys(entry).length > 0) out[locale] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

function asFormats(v: unknown): Product["formats"] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (f): f is { format: string; sizeMB: number } =>
      Boolean(f) && typeof f === "object" && typeof (f as { format?: unknown }).format === "string",
  ).map((f) => ({ format: f.format, sizeMB: typeof f.sizeMB === "number" ? f.sizeMB : 0 }));
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export function rowToProduct(row: DbProductRow, seed?: Product): Product {
  const category = (CATEGORY_IDS.has(row.category as CategoryId) ? row.category : seed?.category ?? "ebooks") as CategoryId;
  const formats = asFormats(row.formats);
  const includes = asStrings(row.includes);
  return {
    id: row.id,
    slug: row.slug || seed?.slug || row.id,
    title: row.title || seed?.title || row.id,
    subtitle: row.subtitle || seed?.subtitle || "",
    description: row.description || seed?.description || "",
    category,
    formats: formats.length > 0 ? formats : seed?.formats ?? [],
    priceUSD: row.priceUSD,
    compareAtUSD: row.compareAtUSD ?? seed?.compareAtUSD,
    rating: row.rating || seed?.rating || 0,
    reviewsCount: row.reviewsCount || seed?.reviewsCount || 0,
    badge: (row.badge === "bestseller" || row.badge === "new" ? row.badge : seed?.badge),
    includes: includes.length > 0 ? includes : seed?.includes ?? [],
    preview: row.preview || seed?.preview || "",
    hue: seed && row.publishedAt === "" ? seed.hue : row.hue,
    publishedAt: row.publishedAt || seed?.publishedAt || row.createdAt.toISOString().slice(0, 10),
    language: row.language ?? seed?.language,
    costUSD: typeof row.costUSD === "number" ? row.costUSD : seed?.costUSD,
    publishAt: row.publishAt ?? seed?.publishAt ?? null,
    priceOverrides: asPriceOverrides(row.priceOverrides) ?? seed?.priceOverrides,
    translations: asTranslations(row.translations) ?? seed?.translations,
  };
}

/** Full DB write payload for a catalog product (used by seed/bootstrap/admin). */
export function productToRowData(p: Product) {
  return {
    slug: p.slug,
    title: p.title,
    priceUSD: p.priceUSD,
    subtitle: p.subtitle,
    description: p.description,
    category: p.category,
    formats: p.formats as unknown as import("@prisma/client").Prisma.InputJsonValue,
    compareAtUSD: p.compareAtUSD ?? null,
    rating: p.rating,
    reviewsCount: p.reviewsCount,
    badge: p.badge ?? null,
    includes: p.includes as unknown as import("@prisma/client").Prisma.InputJsonValue,
    preview: p.preview,
    hue: p.hue,
    publishedAt: p.publishedAt,
    language: p.language ?? null,
    costUSD: p.costUSD ?? 0,
    publishAt: p.publishAt ?? null,
    // Prisma JSON columns take Prisma.JsonNull (not a plain null) to store SQL NULL.
    priceOverrides: (p.priceOverrides ?? Prisma.JsonNull) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
    translations: (p.translations ?? Prisma.JsonNull) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
  };
}

// ─── Bootstrap: seed → DB (missing rows + healing legacy rows) ───────────────

async function bootstrapDb(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  try {
    const db = await getDb();
    if (!db) return;
    const rows = await db.product.findMany({ select: { id: true, publishedAt: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const seed of PRODUCTS) {
      const row = byId.get(seed.id);
      if (!row) {
        await db.product.create({ data: { id: seed.id, ...productToRowData(seed) } }).catch(() => undefined);
      } else if (row.publishedAt === "") {
        // Legacy row (old sync wrote title/price only): heal editorial
        // fields from the seed. Title/price/fileKey are NOT touched —
        // they may already be owner data.
        const { slug: _s, title: _t, priceUSD: _p, ...editorial } = productToRowData(seed);
        await db.product.update({ where: { id: seed.id }, data: editorial }).catch(() => undefined);
      }
    }
  } catch {
    // Bootstrap must never break rendering; the merge still serves data.
  }
}

// ─── File-mode overlay (admin edits without a DB) ────────────────────────────

export type OverlayEdit = Partial<
  Pick<Product, "title" | "priceUSD" | "slug" | "subtitle" | "description" | "category" | "compareAtUSD" | "badge" | "language" | "costUSD" | "publishAt" | "priceOverrides" | "translations">
> & { active?: boolean };

export interface CatalogOverrides {
  edits: Record<string, OverlayEdit>;
  created: Product[];
  deactivated: string[];
}

const EMPTY_OVERRIDES: CatalogOverrides = { edits: {}, created: [], deactivated: [] };

export function sanitizeOverrides(raw: unknown): CatalogOverrides {
  if (!raw || typeof raw !== "object") return structuredClone(EMPTY_OVERRIDES);
  const r = raw as Partial<CatalogOverrides>;
  return {
    edits: r.edits && typeof r.edits === "object" ? r.edits : {},
    created: Array.isArray(r.created) ? r.created : [],
    deactivated: Array.isArray(r.deactivated) ? r.deactivated.filter((s): s is string => typeof s === "string") : [],
  };
}

async function loadOverrides(): Promise<CatalogOverrides> {
  return getJsonConfig<CatalogOverrides>("catalog_overrides_v1", "catalog-overrides.json", sanitizeOverrides, structuredClone(EMPTY_OVERRIDES));
}

function applyOverrides(seeds: Product[], overrides: CatalogOverrides): Product[] {
  const deactivated = new Set(overrides.deactivated);
  const out: Product[] = [];
  for (const seed of seeds) {
    if (deactivated.has(seed.id)) continue;
    const edit = overrides.edits[seed.id];
    if (edit?.active === false) continue;
    if (edit) {
      const { active: _active, ...rest } = edit;
      out.push({ ...seed, ...rest });
    } else {
      out.push(seed);
    }
  }
  for (const created of overrides.created) {
    if (!deactivated.has(created.id)) out.push(created);
  }
  return out;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

async function resolve(): Promise<Resolution> {
  if (await dbReachable()) {
    try {
      await bootstrapDb();
      const db = await getDb();
      if (db) {
        const rows = (await db.product.findMany({ orderBy: { createdAt: "asc" } })) as DbProductRow[];
        const seedIndex = new Map(PRODUCTS.map((p) => [p.id, p]));
        const merged = rows.map((row) => ({ product: rowToProduct(row, seedIndex.get(row.id)), active: row.active }));
        const all = merged.map((m) => m.product);
        const products = merged.filter((m) => m.active).map((m) => m.product);
        return { products, all, source: "db", at: Date.now() };
      }
    } catch (err) {
      console.error("[astralium] catalog DB read failed; falling back to file catalog.", err instanceof Error ? err.message : err);
    }
  }
  const overrides = await loadOverrides();
  const products = applyOverrides(PRODUCTS, overrides);
  // `all` (admin list, existence checks) must carry the SAME overlay
  // edits as the storefront list — previously it returned un-edited
  // seeds in file mode, so the office/AI read models showed stale
  // prices and titles while the storefront already showed the edit.
  // (Found by the Phase 5 upgrade AI-tools suite; DB mode was never
  // affected because its `all` comes from the rows themselves.)
  const all = [
    ...PRODUCTS.map((seed) => {
      const edit = overrides.edits[seed.id];
      if (!edit) return seed;
      const { active: _active, ...rest } = edit;
      return { ...seed, ...rest };
    }),
    ...overrides.created,
  ];
  return { products, all, source: "file", at: Date.now() };
}

async function resolution(): Promise<Resolution> {
  if (cached && Date.now() - cached.at < RESOLUTION_TTL_MS) return cached;
  if (!inflight) {
    inflight = resolve()
      .then((r) => {
        cached = r;
        return r;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// ─── Scheduling + locale overlay (Phase 4 upgrade) ───────────────────────────

/** Scheduled publishing: a product with a future publishAt is not yet storefront-visible. */
export function isScheduledHidden(p: Product, now: Date = new Date()): boolean {
  if (!p.publishAt) return false;
  const t = new Date(p.publishAt).getTime();
  return Number.isFinite(t) && t > now.getTime();
}

/** Apply a product's per-locale translation over its base editorial fields. */
export function applyLocaleOverlay(p: Product, locale?: string): Product {
  if (!locale || !p.translations) return p;
  const t = p.translations[locale] ?? p.translations[locale.split("-")[0]];
  if (!t) return p;
  return {
    ...p,
    title: t.title || p.title,
    subtitle: t.subtitle !== undefined ? t.subtitle : p.subtitle,
    description: t.description !== undefined ? t.description : p.description,
  };
}

function storefrontView(products: Product[], locale?: string): Product[] {
  const now = new Date();
  return products.filter((p) => !isScheduledHidden(p, now)).map((p) => applyLocaleOverlay(p, locale));
}

/** The storefront catalog (active + published only) from the active source of truth. */
export async function getStorefrontProducts(locale?: string): Promise<Product[]> {
  return storefrontView((await resolution()).products, locale);
}

export async function getStorefrontProductBySlug(slug: string, locale?: string): Promise<Product | null> {
  const { products } = await resolution();
  const found = products.find((p) => p.slug === slug) ?? null;
  if (!found || isScheduledHidden(found)) return null;
  return applyLocaleOverlay(found, locale);
}

export async function getStorefrontProductById(id: string, locale?: string): Promise<Product | null> {
  const { products } = await resolution();
  const found = products.find((p) => p.id === id) ?? null;
  if (!found || isScheduledHidden(found)) return null;
  return applyLocaleOverlay(found, locale);
}

/** Which source served the last resolution ("db" | "file") — for admin/reporting honesty. */
export async function catalogSource(): Promise<CatalogSource> {
  return (await resolution()).source;
}

/** Admin view: every product including inactive ones, with its source. */
export async function listAdminProducts(): Promise<{ products: Product[]; inactiveIds: string[]; source: CatalogSource }> {
  const r = await resolution();
  const activeIds = new Set(r.products.map((p) => p.id));
  return {
    products: r.all,
    inactiveIds: r.all.filter((p) => !activeIds.has(p.id)).map((p) => p.id),
    source: r.source,
  };
}

// ─── Admin writes ────────────────────────────────────────────────────────────

export interface ProductPatch {
  title?: string;
  priceUSD?: number;
  slug?: string;
  active?: boolean;
  subtitle?: string;
  description?: string;
  // Phase 4 upgrade (Manager's Office product editor):
  category?: CategoryId;
  compareAtUSD?: number | null;
  badge?: "bestseller" | "new" | null;
  language?: string | null;
  costUSD?: number;
  publishAt?: string | null;
  priceOverrides?: Record<string, number>;
  translations?: Product["translations"];
}

function sanitizePatch(patch: ProductPatch): ProductPatch {
  const out: ProductPatch = {};
  if (typeof patch.title === "string" && patch.title.trim()) out.title = patch.title.trim().slice(0, 200);
  if (typeof patch.priceUSD === "number" && Number.isFinite(patch.priceUSD) && patch.priceUSD >= 0) {
    out.priceUSD = Math.round(patch.priceUSD * 100) / 100;
  }
  if (typeof patch.slug === "string" && /^[a-z0-9][a-z0-9-]{1,80}$/.test(patch.slug.trim())) out.slug = patch.slug.trim();
  if (typeof patch.active === "boolean") out.active = patch.active;
  if (typeof patch.subtitle === "string") out.subtitle = patch.subtitle.slice(0, 300);
  if (typeof patch.description === "string") out.description = patch.description.slice(0, 5000);
  if (typeof patch.category === "string" && CATEGORY_IDS.has(patch.category as CategoryId)) out.category = patch.category;
  if (patch.compareAtUSD === null) out.compareAtUSD = null;
  else if (typeof patch.compareAtUSD === "number" && Number.isFinite(patch.compareAtUSD) && patch.compareAtUSD >= 0) {
    out.compareAtUSD = Math.round(patch.compareAtUSD * 100) / 100;
  }
  if (patch.badge === null || patch.badge === "bestseller" || patch.badge === "new") out.badge = patch.badge;
  if (patch.language === null) out.language = null;
  else if (typeof patch.language === "string" && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(patch.language)) out.language = patch.language;
  if (typeof patch.costUSD === "number" && Number.isFinite(patch.costUSD) && patch.costUSD >= 0) {
    out.costUSD = Math.round(patch.costUSD * 100) / 100;
  }
  if (patch.publishAt === null) out.publishAt = null;
  else if (typeof patch.publishAt === "string" && Number.isFinite(new Date(patch.publishAt).getTime())) {
    out.publishAt = new Date(patch.publishAt).toISOString();
  }
  const overrides = asPriceOverrides(patch.priceOverrides);
  if (overrides !== undefined || patch.priceOverrides !== undefined) out.priceOverrides = overrides ?? {};
  const translations = asTranslations(patch.translations);
  if (translations !== undefined || patch.translations !== undefined) out.translations = translations ?? {};
  return out;
}

/**
 * Apply an admin product edit to the ACTIVE source of truth (DB row or
 * file overlay) and invalidate the storefront cache — the next read
 * shows the change with no file edit and no redeploy.
 */
export async function adminUpdateProduct(
  id: string,
  patch: ProductPatch,
): Promise<{ ok: boolean; persisted: "db" | "file" | null; error?: string }> {
  const clean = sanitizePatch(patch);
  if (Object.keys(clean).length === 0) return { ok: false, persisted: null, error: "EMPTY_PATCH" };

  if (await dbReachable()) {
    try {
      const db = await getDb();
      if (db) {
        const seed = getProductById(id);
        const data: Prisma.ProductUpdateInput = { ...clean };
        await db.product.upsert({
          where: { id },
          create: {
            ...(seed ? productToRowData(seed) : {}),
            ...(data as Prisma.ProductCreateInput),
            id,
            slug: clean.slug ?? seed?.slug ?? id,
            title: clean.title ?? seed?.title ?? id,
            priceUSD: clean.priceUSD ?? seed?.priceUSD ?? 0,
          },
          update: data,
        });
        invalidateCatalogCache();
        return { ok: true, persisted: "db" };
      }
    } catch (err) {
      return { ok: false, persisted: null, error: err instanceof Error ? err.message : "DB_WRITE_FAILED" };
    }
  }

  // File mode: the overlay's Product-shaped fields cannot hold SQL-style
  // nulls, so "clear this field" (null) becomes "absent" (undefined),
  // which JSON persistence drops — the base value shows through again.
  const { badge, compareAtUSD, language, active: _active, ...restClean } = clean;
  const fileEdit: OverlayEdit = { ...restClean };
  if (badge !== undefined) fileEdit.badge = badge ?? undefined;
  if (compareAtUSD !== undefined) fileEdit.compareAtUSD = compareAtUSD ?? undefined;
  if (language !== undefined) fileEdit.language = language ?? undefined;

  const overrides = await loadOverrides();
  const createdIdx = overrides.created.findIndex((p) => p.id === id);
  if (createdIdx >= 0) {
    overrides.created[createdIdx] = { ...overrides.created[createdIdx], ...fileEdit };
    if (clean.active === false) overrides.deactivated.push(id);
    if (clean.active === true) overrides.deactivated = overrides.deactivated.filter((d) => d !== id);
  } else {
    overrides.edits[id] = { ...overrides.edits[id], ...fileEdit, ...(clean.active !== undefined ? { active: clean.active } : {}) };
  }
  await setJsonConfig("catalog_overrides_v1", "catalog-overrides.json", overrides, sanitizeOverrides);
  invalidateCatalogCache();
  return { ok: true, persisted: "file" };
}

// ─── Create / duplicate (Phase 4 upgrade) ────────────────────────────────────

export interface NewProductInput {
  id: string;
  slug: string;
  title: string;
  priceUSD: number;
  category?: string;
  subtitle?: string;
  description?: string;
}

/** Validate + normalize a product-creation request. Returns null when invalid. */
export function sanitizeNewProduct(raw: unknown): NewProductInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = typeof r.slug === "string" ? r.slug.trim() : "";
  const title = typeof r.title === "string" ? r.title.trim().slice(0, 200) : "";
  const priceUSD = typeof r.priceUSD === "number" && Number.isFinite(r.priceUSD) && r.priceUSD >= 0
    ? Math.round(r.priceUSD * 100) / 100
    : NaN;
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug) || !title || !Number.isFinite(priceUSD)) return null;
  const id = typeof r.id === "string" && /^[a-z0-9][a-z0-9-]{1,60}$/.test(r.id.trim())
    ? r.id.trim()
    : `p-${slug}`.slice(0, 60);
  return {
    id,
    slug,
    title,
    priceUSD,
    category: typeof r.category === "string" && CATEGORY_IDS.has(r.category as CategoryId) ? r.category : "ebooks",
    subtitle: typeof r.subtitle === "string" ? r.subtitle.slice(0, 300) : "",
    description: typeof r.description === "string" ? r.description.slice(0, 5000) : "",
  };
}

function productFromInput(input: NewProductInput, base?: Product): Product {
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    subtitle: input.subtitle ?? base?.subtitle ?? "",
    description: input.description ?? base?.description ?? "",
    category: (input.category ?? base?.category ?? "ebooks") as CategoryId,
    formats: base?.formats ?? [{ format: "PDF", sizeMB: 0 }],
    priceUSD: input.priceUSD,
    compareAtUSD: base?.compareAtUSD,
    rating: base?.rating ?? 0,
    reviewsCount: base?.reviewsCount ?? 0,
    badge: base?.badge,
    includes: base?.includes ?? [],
    preview: base?.preview ?? "",
    hue: base?.hue ?? 222,
    publishedAt: new Date().toISOString().slice(0, 10),
    language: base?.language,
    costUSD: base?.costUSD ?? 0,
    publishAt: base?.publishAt ?? null,
    priceOverrides: base?.priceOverrides,
    translations: base?.translations,
  };
}

/** Create a brand-new product in the active source of truth. */
export async function adminCreateProduct(
  input: NewProductInput,
  opts: { duplicateOf?: Product; active?: boolean } = {},
): Promise<{ ok: boolean; persisted: "db" | "file" | null; error?: string; product?: Product }> {
  const r = await resolution();
  if (r.all.some((p) => p.id === input.id)) return { ok: false, persisted: null, error: "ID_TAKEN" };
  if (r.all.some((p) => p.slug === input.slug)) return { ok: false, persisted: null, error: "SLUG_TAKEN" };
  const product = productFromInput(input, opts.duplicateOf);
  const active = opts.active ?? true;

  if (await dbReachable()) {
    try {
      const db = await getDb();
      if (db) {
        await db.product.create({
          data: { id: product.id, active, ...productToRowData(product) },
        });
        invalidateCatalogCache();
        return { ok: true, persisted: "db", product };
      }
    } catch (err) {
      return { ok: false, persisted: null, error: err instanceof Error ? err.message : "DB_WRITE_FAILED" };
    }
  }
  const overrides = await loadOverrides();
  overrides.created.push(product);
  if (!active) overrides.deactivated.push(product.id);
  await setJsonConfig("catalog_overrides_v1", "catalog-overrides.json", overrides, sanitizeOverrides);
  invalidateCatalogCache();
  return { ok: true, persisted: "file", product };
}
