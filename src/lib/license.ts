/**
 * License keys (Phase 5, feature 18). Flag `license_keys` — default ON.
 *
 * Products listed in the owner config require a license: on delivery a
 * unique key is generated per (order, product) and shown to the buyer
 * ONCE (in the delivery email). Storage keeps only the SHA-256 hash of
 * the key plus its last 4 characters for display — a database leak can
 * never reveal a usable key, and a key can never be re-displayed.
 *
 * Verification is public and rate-limited per IP (routes). Distinct
 * failure codes: KEY_NOT_FOUND, KEY_REVOKED, ACTIVATION_LIMIT_REACHED.
 * Activations are stored as SHA-256 hashes of the device id — raw device
 * identifiers are never persisted. Re-activating the SAME device is
 * idempotent and does not consume another slot.
 *
 * Persistence: DB LicenseKey table when configured, else
 * .data/license-keys.json (same pattern as gifts/reviews).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { PRODUCTS, getProductById } from "../data/products.ts";
import { hashEmail } from "./reviews.ts";

// ─── Configuration (owner-editable) ──────────────────────────────────────────

export interface LicenseConfig {
  requiredProductIds: string[];
  defaultActivationLimit: number;
  perProductLimit: Record<string, number>;
}

export const EMPTY_LICENSE_CONFIG: LicenseConfig = {
  requiredProductIds: [],
  defaultActivationLimit: 3,
  perProductLimit: {},
};

function clampLimit(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 3;
}

export function sanitizeLicenseConfig(raw: unknown): LicenseConfig {
  const r = (raw ?? {}) as Partial<LicenseConfig>;
  const ids = Array.isArray(r.requiredProductIds)
    ? [...new Set(r.requiredProductIds.filter((id): id is string => typeof id === "string" && Boolean(getProductById(id))))]
    : [];
  const perProductLimit: Record<string, number> = {};
  if (r.perProductLimit && typeof r.perProductLimit === "object") {
    for (const [pid, v] of Object.entries(r.perProductLimit)) {
      if (getProductById(pid)) perProductLimit[pid] = clampLimit(v);
    }
  }
  return {
    requiredProductIds: ids,
    defaultActivationLimit: clampLimit(r.defaultActivationLimit ?? 3),
    perProductLimit,
  };
}

export async function getLicenseConfig(): Promise<LicenseConfig> {
  return getJsonConfig("license_config", "license-config.json", sanitizeLicenseConfig, EMPTY_LICENSE_CONFIG);
}

export async function setLicenseConfig(
  value: LicenseConfig,
): Promise<{ persisted: "db" | "file"; value: LicenseConfig }> {
  return setJsonConfig("license_config", "license-config.json", value, sanitizeLicenseConfig);
}

export function activationLimitFor(config: LicenseConfig, productId: string): number {
  return config.perProductLimit[productId] ?? config.defaultActivationLimit;
}

export function productRequiresLicense(config: LicenseConfig, productId: string): boolean {
  return config.requiredProductIds.includes(productId);
}

// ─── Key generation / normalisation ──────────────────────────────────────────

// Unambiguous alphabet: no 0/O, 1/I/L confusion pairs beyond L (kept out too).
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const KEY_BODY_LENGTH = 16;

/** Canonical form used for hashing: "ASTL" + 16 alphabet chars, no dashes. */
export function normalizeLicenseKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isLicenseKeyShape(raw: string): boolean {
  const n = normalizeLicenseKey(raw);
  return n.startsWith("ASTL") && n.length === 4 + KEY_BODY_LENGTH &&
    [...n.slice(4)].every((c) => KEY_ALPHABET.includes(c));
}

export function hashLicenseKey(raw: string): string {
  return createHash("sha256").update(normalizeLicenseKey(raw)).digest("hex");
}

export function generateLicenseKey(): { display: string; canonical: string; keyHash: string; last4: string } {
  const bytes = randomBytes(KEY_BODY_LENGTH);
  let body = "";
  for (let i = 0; i < KEY_BODY_LENGTH; i++) body += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  const canonical = `ASTL${body}`;
  const display = `ASTL-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12)}`;
  return { display, canonical, keyHash: hashLicenseKey(canonical), last4: body.slice(-4) };
}

/** Masked display for admin lists — the full key is unrecoverable by design. */
export function maskLicenseKey(last4: string): string {
  return `ASTL-••••-••••-••••-${last4}`;
}

// ─── Records & persistence ───────────────────────────────────────────────────

export interface LicenseKeyRecord {
  id: string;
  keyHash: string;
  last4: string;
  orderId: string;
  productId: string;
  emailHash: string;
  activationLimit: number;
  activations: string[]; // device-id hashes
  status: "active" | "revoked";
  createdAt: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "license-keys.json");

async function readStore(): Promise<LicenseKeyRecord[]> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as LicenseKeyRecord[];
  } catch {
    return [];
  }
}

async function writeStore(list: LicenseKeyRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

type DbRow = {
  id: string; keyHash: string; last4: string; orderId: string; productId: string;
  emailHash: string; activationLimit: number; activations: string[]; status: string;
  createdAt: Date;
};

function fromRow(r: DbRow): LicenseKeyRecord {
  return {
    id: r.id, keyHash: r.keyHash, last4: r.last4, orderId: r.orderId, productId: r.productId,
    emailHash: r.emailHash, activationLimit: r.activationLimit, activations: [...r.activations],
    status: r.status === "revoked" ? "revoked" : "active", createdAt: r.createdAt.toISOString(),
  };
}

async function findByHash(keyHash: string): Promise<LicenseKeyRecord | null> {
  try {
    const db = await getDb();
    if (db) {
      const row = await db.licenseKey.findUnique({ where: { keyHash } });
      if (row) return fromRow(row);
    }
  } catch { /* fall through */ }
  return (await readStore()).find((k) => k.keyHash === keyHash) ?? null;
}

async function findByOrderProduct(orderId: string, productId: string): Promise<LicenseKeyRecord | null> {
  try {
    const db = await getDb();
    if (db) {
      const row = await db.licenseKey.findFirst({ where: { orderId, productId } });
      if (row) return fromRow(row);
    }
  } catch { /* fall through */ }
  return (await readStore()).find((k) => k.orderId === orderId && k.productId === productId) ?? null;
}

async function saveRecord(rec: LicenseKeyRecord): Promise<"db" | "file"> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.licenseKey.upsert({
        where: { keyHash: rec.keyHash },
        create: {
          id: rec.id, keyHash: rec.keyHash, last4: rec.last4, orderId: rec.orderId,
          productId: rec.productId, emailHash: rec.emailHash,
          activationLimit: rec.activationLimit, activations: rec.activations, status: rec.status,
        },
        update: { activations: rec.activations, status: rec.status },
      });
      return "db";
    } catch { /* fall through to file */ }
  }
  const all = await readStore();
  const idx = all.findIndex((k) => k.keyHash === rec.keyHash);
  if (idx >= 0) all[idx] = rec; else all.push(rec);
  await writeStore(all);
  return "file";
}

// ─── Issuance (on delivery) ──────────────────────────────────────────────────

export interface IssuedKey {
  productId: string;
  title: string;
  /** Plaintext key — available ONLY at issuance, for the delivery email. */
  key: string;
}

/** Idempotent per (orderId, productId): a replay never mints a second key. */
export async function issueLicenseKey(input: {
  orderId: string;
  productId: string;
  email: string;
  config?: LicenseConfig;
}): Promise<{ issued: IssuedKey | null; record: LicenseKeyRecord }> {
  const existing = await findByOrderProduct(input.orderId, input.productId);
  if (existing) return { issued: null, record: existing };
  const config = input.config ?? (await getLicenseConfig());
  const gen = generateLicenseKey();
  const record: LicenseKeyRecord = {
    id: randomUUID(),
    keyHash: gen.keyHash,
    last4: gen.last4,
    orderId: input.orderId,
    productId: input.productId,
    emailHash: hashEmail(input.email),
    activationLimit: activationLimitFor(config, input.productId),
    activations: [],
    status: "active",
    createdAt: new Date().toISOString(),
  };
  await saveRecord(record);
  return {
    issued: { productId: input.productId, title: getProductById(input.productId)?.title ?? input.productId, key: gen.display },
    record,
  };
}

/** Issue keys for the licensed products of an order; returns only NEW keys. */
export async function issueLicenseKeysForOrder(
  orderId: string,
  email: string,
  productIds: string[],
): Promise<IssuedKey[]> {
  const config = await getLicenseConfig();
  const out: IssuedKey[] = [];
  for (const pid of new Set(productIds)) {
    if (!productRequiresLicense(config, pid)) continue;
    const { issued } = await issueLicenseKey({ orderId, productId: pid, email, config });
    if (issued) out.push(issued);
  }
  return out;
}

/** Delivery-email section. Keys appear here and nowhere else after issuance. */
export function licenseKeysEmailHtml(keys: IssuedKey[]): string {
  if (keys.length === 0) return "";
  const rows = keys
    .map((k) => `<tr><td style="padding:8px 0">${k.title}</td><td><code>${k.key}</code></td></tr>`)
    .join("");
  return `<h2>Your license keys</h2><table>${rows}</table>
  <p>Keep these safe — each key is shown only in this email. Activate on up to the stated number of devices; verify any time from the store's license page.</p>`;
}

// ─── Verification & activation ───────────────────────────────────────────────

export type LicenseCode = "OK" | "KEY_NOT_FOUND" | "KEY_REVOKED" | "ACTIVATION_LIMIT_REACHED";

export interface LicenseVerdict {
  code: LicenseCode;
  productId?: string;
  activationsUsed?: number;
  activationLimit?: number;
  activationsRemaining?: number;
  alreadyActivated?: boolean;
}

export function verdictFor(rec: LicenseKeyRecord | null): LicenseVerdict {
  if (!rec) return { code: "KEY_NOT_FOUND" };
  const base = {
    productId: rec.productId,
    activationsUsed: rec.activations.length,
    activationLimit: rec.activationLimit,
    activationsRemaining: Math.max(0, rec.activationLimit - rec.activations.length),
  };
  if (rec.status === "revoked") return { code: "KEY_REVOKED", ...base };
  if (rec.activations.length >= rec.activationLimit) return { code: "ACTIVATION_LIMIT_REACHED", ...base };
  return { code: "OK", ...base };
}

export async function verifyLicenseKey(rawKey: string): Promise<LicenseVerdict> {
  if (!isLicenseKeyShape(rawKey)) return { code: "KEY_NOT_FOUND" };
  return verdictFor(await findByHash(hashLicenseKey(rawKey)));
}

export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId.trim()).digest("hex");
}

export async function activateLicenseKey(rawKey: string, deviceId: string): Promise<LicenseVerdict> {
  if (!isLicenseKeyShape(rawKey) || !deviceId.trim()) return { code: "KEY_NOT_FOUND" };
  const rec = await findByHash(hashLicenseKey(rawKey));
  if (!rec) return { code: "KEY_NOT_FOUND" };
  if (rec.status === "revoked") return verdictFor(rec);
  const deviceHash = hashDeviceId(deviceId);
  if (rec.activations.includes(deviceHash)) {
    return { ...verdictFor(rec), alreadyActivated: true };
  }
  if (rec.activations.length >= rec.activationLimit) return verdictFor(rec);
  rec.activations = [...rec.activations, deviceHash];
  await saveRecord(rec);
  return { ...verdictFor(rec), code: "OK", alreadyActivated: false };
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function listLicenseKeys(limit = 200): Promise<LicenseKeyRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.licenseKey.findMany({ orderBy: { createdAt: "desc" }, take: limit });
      if (rows.length > 0) return rows.map(fromRow);
    }
  } catch { /* fall through */ }
  return (await readStore())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function revokeLicenseKey(id: string): Promise<{ ok: boolean }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.licenseKey.update({ where: { id }, data: { status: "revoked" } });
      return { ok: true };
    } catch { /* fall through — the key may live in the file store */ }
  }
  const all = await readStore();
  const idx = all.findIndex((k) => k.id === id);
  if (idx === -1) return { ok: false };
  all[idx] = { ...all[idx], status: "revoked" };
  await writeStore(all);
  return { ok: true };
}

/** Catalog ids, exported for admin config validation messages. */
export const LICENSE_CATALOG_IDS = PRODUCTS.map((p) => p.id);

// ─── Per-IP rate limiting (routes) ───────────────────────────────────────────

export interface RateLimiter {
  hit(key: string, nowMs?: number): { allowed: boolean; retryAfterMs: number };
}

/** Sliding-window limiter. In-memory per process — stated honestly: on a
 * multi-instance deployment this is a per-instance budget, not a global
 * one; it still stops casual key-guessing cold. */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, number[]>();
  return {
    hit(key: string, nowMs: number = Date.now()) {
      const cutoff = nowMs - windowMs;
      const arr = (buckets.get(key) ?? []).filter((t) => t > cutoff);
      if (arr.length >= limit) {
        buckets.set(key, arr);
        return { allowed: false, retryAfterMs: Math.max(0, arr[0] + windowMs - nowMs) };
      }
      arr.push(nowMs);
      buckets.set(key, arr);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}
