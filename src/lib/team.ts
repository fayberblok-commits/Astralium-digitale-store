/**
 * Team access (Phase 6, feature 29). Flag `team_access` — default ON.
 *
 * Roles & permission matrix (enforced server-side on every admin API
 * route via requireAdmin below; the UI hiding buttons is cosmetic only):
 *
 *   permission    owner  admin  support  viewer   covers
 *   read           ✓      ✓       ✓        ✓      viewing admin data (GET)
 *   moderate       ✓      ✓       ✓        –      review moderation, alert mark-read
 *   support_ops    ✓      ✓       ✓        –      delivery resend & order support actions
 *   content        ✓      ✓       –        –      blog, bundles, offers, versions, A/B tests
 *   files          ✓      ✓       –        –      product-file upload & bindings
 *   commerce       ✓      ✓       –        –      flash sales, commerce config, license
 *                                                 config/revoke, fraud resolve/blacklist
 *   settings       ✓      ✓       –        –      feature flags, privacy retention,
 *                                                 push broadcast, owner-alert channels
 *   audit          ✓      ✓       –        –      reading the audit log
 *   team           ✓      –       –        –      creating/deleting accounts, role changes
 *
 * The single ADMIN_PASSWORD login keeps working exactly as before and
 * acts as the bootstrap OWNER (via "password") — it is how the first
 * team accounts get created, and it is never a database row.
 *
 * Storage: AdminUser table, else .data/admin-users.json. Passwords are
 * scrypt hashes; TOTP secrets are AES-256-GCM ciphertext under a key
 * derived from ADMIN_PASSWORD (the bootstrap secret, always present
 * when admin is enabled) — plaintext secrets are never stored; backup
 * codes are SHA-256 hashes and single-use.
 *
 * Audit log: AuditLog table, else .data/audit-log.json. APPEND-ONLY by
 * construction — this module exports create + list, no update/delete.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID,
  scryptSync, timingSafeEqual,
} from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "./db.ts";
import { getFlag } from "./flags.ts";
import { ADMIN_COOKIE, isAdminSession } from "./admin.ts";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp.ts";

// ─── Roles & permissions ─────────────────────────────────────────────────────

export type Role = "owner" | "admin" | "support" | "viewer";
export const ROLES: Role[] = ["owner", "admin", "support", "viewer"];

export type Permission =
  | "read" | "moderate" | "support_ops" | "content" | "files"
  | "commerce" | "settings" | "audit" | "team";

const MATRIX: Record<Role, Permission[]> = {
  owner: ["read", "moderate", "support_ops", "content", "files", "commerce", "settings", "audit", "team"],
  admin: ["read", "moderate", "support_ops", "content", "files", "commerce", "settings", "audit"],
  support: ["read", "moderate", "support_ops"],
  viewer: ["read"],
};

/** Pure permission check — the single source of truth for the matrix. */
export function can(role: Role, permission: Permission): boolean {
  return (MATRIX[role] ?? []).includes(permission);
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

// ─── Password hashing (scrypt) ───────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltB, hashB] = stored.split(":");
    if (scheme !== "scrypt" || !saltB || !hashB) return false;
    const expected = Buffer.from(hashB, "base64url");
    const actual = scryptSync(password, Buffer.from(saltB, "base64url"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ─── Secret encryption (TOTP secrets at rest) ────────────────────────────────

function secretKey(salt: Buffer): Buffer {
  const root = process.env.ADMIN_PASSWORD;
  if (!root) throw new Error("ADMIN_NOT_CONFIGURED");
  return scryptSync(root, salt, 32);
}

export function encryptSecret(plaintext: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(salt), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["t1", salt.toString("base64url"), iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(ciphertext: string): string | null {
  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 5 || parts[0] !== "t1") return null;
    const [, saltB, ivB, tagB, dataB] = parts;
    const decipher = createDecipheriv("aes-256-gcm", secretKey(Buffer.from(saltB, "base64url")), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ─── Backup codes ────────────────────────────────────────────────────────────

const BACKUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(8);
    const chars = [...raw].map((b) => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join("");
    codes.push(`${chars.slice(0, 4)}-${chars.slice(4)}`);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

// ─── Admin user store ────────────────────────────────────────────────────────

export interface AdminUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  totpSecretCipher: string | null;
  totpEnabled: boolean;
  totpLastStep: number | null;
  backupCodeHashes: string[];
  createdAt: string;
  updatedAt: string;
}

const USERS_PATH = path.join(process.cwd(), ".data", "admin-users.json");

async function readFileUsers(): Promise<AdminUserRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(USERS_PATH, "utf8")) as AdminUserRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeFileUsers(list: AdminUserRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(USERS_PATH), { recursive: true });
  await fs.writeFile(USERS_PATH, JSON.stringify(list, null, 2), "utf8");
}

type DbUser = {
  id: string; email: string; passwordHash: string; role: string;
  totpSecretCipher: string | null; totpEnabled: boolean; totpLastStep: bigint | null;
  backupCodeHashes: string[]; createdAt: Date; updatedAt: Date;
};

function fromDb(row: DbUser): AdminUserRecord {
  return {
    id: row.id, email: row.email, passwordHash: row.passwordHash,
    role: isRole(row.role) ? row.role : "viewer",
    totpSecretCipher: row.totpSecretCipher, totpEnabled: row.totpEnabled,
    totpLastStep: row.totpLastStep == null ? null : Number(row.totpLastStep),
    backupCodeHashes: row.backupCodeHashes,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function saveUser(user: AdminUserRecord): Promise<"db" | "file"> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const data = {
        email: user.email, passwordHash: user.passwordHash, role: user.role,
        totpSecretCipher: user.totpSecretCipher, totpEnabled: user.totpEnabled,
        totpLastStep: user.totpLastStep == null ? null : BigInt(user.totpLastStep),
        backupCodeHashes: user.backupCodeHashes,
      };
      await db.adminUser.upsert({ where: { id: user.id }, create: { id: user.id, ...data }, update: data });
      return "db";
    } catch { /* fall through to file */ }
  }
  const all = await readFileUsers();
  const idx = all.findIndex((u) => u.id === user.id);
  if (idx >= 0) all[idx] = user; else all.push(user);
  await writeFileUsers(all);
  return "file";
}

export async function findUserByEmail(email: string): Promise<AdminUserRecord | null> {
  const clean = email.trim().toLowerCase();
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.adminUser.findUnique({ where: { email: clean } });
      if (row) return fromDb(row as DbUser);
    } catch { /* fall through */ }
  }
  return (await readFileUsers()).find((u) => u.email === clean) ?? null;
}

export async function findUserById(id: string): Promise<AdminUserRecord | null> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.adminUser.findUnique({ where: { id } });
      if (row) return fromDb(row as DbUser);
    } catch { /* fall through */ }
  }
  return (await readFileUsers()).find((u) => u.id === id) ?? null;
}

export async function listUsers(): Promise<AdminUserRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.adminUser.findMany({ orderBy: { createdAt: "asc" } });
      if (rows.length > 0) return rows.map((r) => fromDb(r as DbUser));
    } catch { /* fall through */ }
  }
  return readFileUsers();
}

/** Public shape for the admin UI — never includes hashes or secrets. */
export function publicUser(u: AdminUserRecord): { id: string; email: string; role: Role; totpEnabled: boolean; createdAt: string } {
  return { id: u.id, email: u.email, role: u.role, totpEnabled: u.totpEnabled, createdAt: u.createdAt };
}

export async function createUser(input: { email: string; password: string; role: Role }): Promise<{ ok: true; user: AdminUserRecord } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "INVALID_EMAIL" };
  if (!input.password || input.password.length < 10) return { ok: false, error: "PASSWORD_TOO_SHORT" };
  if (!isRole(input.role)) return { ok: false, error: "INVALID_ROLE" };
  if (await findUserByEmail(email)) return { ok: false, error: "EMAIL_TAKEN" };
  const now = new Date().toISOString();
  const user: AdminUserRecord = {
    id: randomUUID(), email, passwordHash: hashPassword(input.password), role: input.role,
    totpSecretCipher: null, totpEnabled: false, totpLastStep: null, backupCodeHashes: [],
    createdAt: now, updatedAt: now,
  };
  await saveUser(user);
  return { ok: true, user };
}

export async function deleteUser(id: string): Promise<{ ok: boolean }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try { await db.adminUser.delete({ where: { id } }); return { ok: true }; } catch { /* fall through */ }
  }
  const all = await readFileUsers();
  const next = all.filter((u) => u.id !== id);
  if (next.length === all.length) return { ok: false };
  await writeFileUsers(next);
  return { ok: true };
}

export async function setUserRole(id: string, role: Role): Promise<{ ok: boolean }> {
  const user = await findUserById(id);
  if (!user || !isRole(role)) return { ok: false };
  user.role = role;
  user.updatedAt = new Date().toISOString();
  await saveUser(user);
  return { ok: true };
}

// ─── Login (password + optional TOTP / backup code) ──────────────────────────

export type TeamLoginResult =
  | { ok: true; user: AdminUserRecord }
  | { ok: false; error: "INVALID_CREDENTIALS" | "TOTP_REQUIRED" | "TOTP_INVALID" };

export async function loginTeamUser(email: string, password: string, code?: string): Promise<TeamLoginResult> {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "INVALID_CREDENTIALS" }; // generic — never reveal which half failed
  }
  if (!user.totpEnabled) return { ok: true, user };
  if (!code) return { ok: false, error: "TOTP_REQUIRED" };
  const secret = user.totpSecretCipher ? decryptSecret(user.totpSecretCipher) : null;
  if (secret) {
    const verdict = verifyTotp(secret, code, { lastUsedStep: user.totpLastStep });
    if (verdict.ok && verdict.step != null) {
      user.totpLastStep = verdict.step; // replay guard — persisted before session issue
      user.updatedAt = new Date().toISOString();
      await saveUser(user);
      return { ok: true, user };
    }
  }
  const hash = hashBackupCode(code);
  const idx = user.backupCodeHashes.indexOf(hash);
  if (idx >= 0) {
    user.backupCodeHashes.splice(idx, 1); // single-use: consumed on success
    user.updatedAt = new Date().toISOString();
    await saveUser(user);
    return { ok: true, user };
  }
  return { ok: false, error: "TOTP_INVALID" };
}

// ─── TOTP enrollment ─────────────────────────────────────────────────────────

/** Start enrollment: store a pending (not yet enabled) encrypted secret. */
export async function startTotpEnrollment(userId: string): Promise<{ ok: boolean; secret?: string; uri?: string; error?: string }> {
  const user = await findUserById(userId);
  if (!user) return { ok: false, error: "USER_NOT_FOUND" };
  const secret = generateTotpSecret();
  try {
    user.totpSecretCipher = encryptSecret(secret);
  } catch {
    return { ok: false, error: "ADMIN_NOT_CONFIGURED" };
  }
  user.totpEnabled = false;
  user.updatedAt = new Date().toISOString();
  await saveUser(user);
  return { ok: true, secret, uri: otpauthUri({ issuer: "Astralium Control", account: user.email, secret }) };
}

/** Confirm enrollment with a live code; returns backup codes ONCE. */
export async function confirmTotpEnrollment(userId: string, code: string): Promise<{ ok: boolean; backupCodes?: string[]; error?: string }> {
  const user = await findUserById(userId);
  if (!user?.totpSecretCipher) return { ok: false, error: "ENROLLMENT_NOT_STARTED" };
  const secret = decryptSecret(user.totpSecretCipher);
  if (!secret) return { ok: false, error: "SECRET_UNREADABLE" };
  const verdict = verifyTotp(secret, code, { lastUsedStep: null });
  if (!verdict.ok) return { ok: false, error: "TOTP_INVALID" };
  const backupCodes = generateBackupCodes(8);
  user.totpEnabled = true;
  user.totpLastStep = verdict.step;
  user.backupCodeHashes = backupCodes.map(hashBackupCode);
  user.updatedAt = new Date().toISOString();
  await saveUser(user);
  return { ok: true, backupCodes };
}

export async function disableTotp(userId: string): Promise<{ ok: boolean }> {
  const user = await findUserById(userId);
  if (!user) return { ok: false };
  user.totpEnabled = false;
  user.totpSecretCipher = null;
  user.totpLastStep = null;
  user.backupCodeHashes = [];
  user.updatedAt = new Date().toISOString();
  await saveUser(user);
  return { ok: true };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface AdminActor {
  actor: string; // admin email, or "bootstrap-owner"
  role: Role;
  via: "password" | "team";
  userId: string | null;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function sessionSigningKey(): string | null {
  return process.env.ADMIN_PASSWORD ?? null;
}

/** Signed team session token: v2.<b64url payload>.<hmac> (key = ADMIN_PASSWORD). */
export function createTeamSession(user: AdminUserRecord, nowMs: number = Date.now()): string | null {
  const key = sessionSigningKey();
  if (!key) return null;
  const payload = Buffer.from(JSON.stringify({
    sub: user.id, email: user.email, role: user.role, exp: nowMs + SESSION_TTL_MS,
  })).toString("base64url");
  const sig = createHmac("sha256", key).update(`v2.${payload}`).digest("base64url");
  return `v2.${payload}.${sig}`;
}

export function parseTeamSession(token: string | undefined, nowMs: number = Date.now()): AdminActor | null {
  const key = sessionSigningKey();
  if (!key || !token || !token.startsWith("v2.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", key).update(`v2.${parts[1]}`).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      sub?: string; email?: string; role?: string; exp?: number;
    };
    if (!payload.sub || !payload.email || !isRole(payload.role) || typeof payload.exp !== "number") return null;
    if (payload.exp < nowMs) return null;
    return { actor: payload.email, role: payload.role, via: "team", userId: payload.sub };
  } catch {
    return null;
  }
}

/**
 * Resolve the acting admin from a cookie value. The legacy
 * ADMIN_PASSWORD session token remains valid and maps to the bootstrap
 * owner; team sessions carry their role in the signed payload.
 */
export function actorFromCookie(cookieValue: string | undefined): AdminActor | null {
  if (!cookieValue) return null;
  if (isAdminSession(cookieValue)) {
    return { actor: "bootstrap-owner", role: "owner", via: "password", userId: null };
  }
  return parseTeamSession(cookieValue);
}

export async function getAdminActor(req: NextRequest): Promise<AdminActor | null> {
  const actor = actorFromCookie(req.cookies.get(ADMIN_COOKIE)?.value);
  if (!actor) return null;
  if (actor.via === "team" && !(await getFlag("team_access"))) return null; // feature off → bootstrap owner only
  if (actor.via === "team" && actor.userId) {
    // Role freshness: a demoted/deleted account loses access immediately,
    // not at token expiry. The role comes from the store, not the token.
    const user = await findUserById(actor.userId);
    if (!user) return null;
    return { ...actor, role: user.role, actor: user.email };
  }
  return actor;
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  // A plain Response (not NextResponse) keeps this module importable by
  // the node --test suites; route handlers accept Response natively.
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Route guard: resolve the actor and check a permission in one call.
 * Returns { actor } or { error } (401 unauthenticated / 403 role-denied).
 */
export async function requireAdmin(
  req: NextRequest,
  permission: Permission,
): Promise<{ actor: AdminActor } | { error: Response }> {
  const actor = await getAdminActor(req);
  if (!actor) {
    return { error: jsonError(401, { error: "ADMIN_UNAUTHORIZED" }) };
  }
  if (!can(actor.role, permission)) {
    return { error: jsonError(403, { error: "FORBIDDEN", role: actor.role, need: permission }) };
  }
  return { actor };
}

// ─── Audit log (append-only) ─────────────────────────────────────────────────

export interface AuditRecord {
  id: string;
  actor: string;
  role: Role;
  action: string;
  target: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

const AUDIT_PATH = path.join(process.cwd(), ".data", "audit-log.json");

async function readFileAudit(): Promise<AuditRecord[]> {
  try {
    const raw = JSON.parse(await fs.readFile(AUDIT_PATH, "utf8")) as AuditRecord[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** Append one audit entry. Never throws — auditing must not break admin work. */
export async function recordAudit(input: {
  actor: AdminActor; action: string; target?: string; detail?: Record<string, unknown>;
}): Promise<void> {
  const entry: AuditRecord = {
    id: randomUUID(),
    actor: input.actor.actor,
    role: input.actor.role,
    action: input.action.slice(0, 80),
    target: (input.target ?? "").slice(0, 200),
    detail: input.detail ?? null,
    createdAt: new Date().toISOString(),
  };
  try {
    const db = await getDb();
    if (db) {
      await db.auditLog.create({
        data: {
          actor: entry.actor, role: entry.role, action: entry.action, target: entry.target,
          detail: (entry.detail ?? undefined) as import("@prisma/client").Prisma.InputJsonValue | undefined,
        },
      });
      return;
    }
  } catch { /* fall through to file */ }
  try {
    const all = await readFileAudit();
    all.push(entry);
    await fs.mkdir(path.dirname(AUDIT_PATH), { recursive: true });
    await fs.writeFile(AUDIT_PATH, JSON.stringify(all, null, 2), "utf8");
  } catch { /* never break the caller */ }
}

export async function listAudit(limit = 200): Promise<AuditRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id, actor: r.actor, role: isRole(r.role) ? r.role : "viewer", action: r.action,
          target: r.target, detail: (r.detail as Record<string, unknown> | null) ?? null,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch { /* fall through */ }
  }
  const all = await readFileAudit();
  return all.slice(-limit).reverse();
}
