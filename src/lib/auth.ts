import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers, auditLogs, customerSessions, customers, loginAttempts } from "@/db/schema";
import { createSignedToken, randomToken, readSignedToken, sha256 } from "@/lib/crypto";

const ADMIN_COOKIE = "astralium_admin_session";
const PENDING_COOKIE = "astralium_admin_pending";
const CUSTOMER_COOKIE = "astralium_customer_session";
const ADMIN_TTL_HOURS = 8;
const CUSTOMER_TTL_DAYS = 30;

export type AdminIdentity = { id: number; email: string; name: string; role: string };
export type CustomerIdentity = { id: number; email: string; name: string; locale: string; referralCode: string };

export async function requestMeta() {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || "127.0.0.1",
    userAgent: headerStore.get("user-agent") ?? "unknown",
  };
}

const isProd = process.env.NODE_ENV === "production";

/* ---------------------------------- admin ---------------------------------- */

export async function getAdminSession(): Promise<AdminIdentity | null> {
  const store = await cookies();
  const raw = store.get(ADMIN_COOKIE)?.value;
  if (!raw) return null;
  const rows = await db
    .select({ admin: adminUsers, session: adminSessions })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.adminId, adminUsers.id))
    .where(
      and(
        eq(adminSessions.tokenHash, sha256(raw)),
        gt(adminSessions.expiresAt, new Date()),
        isNull(adminSessions.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.admin.role !== "owner") return null;
  return { id: row.admin.id, email: row.admin.email, name: row.admin.name, role: row.admin.role };
}

export async function requireOwner(): Promise<AdminIdentity> {
  const admin = await getAdminSession();
  if (!admin) redirect("/admin/login");
  return admin;
}

export async function createAdminSession(adminId: number) {
  const raw = randomToken(32);
  const meta = await requestMeta();
  const expiresAt = new Date(Date.now() + ADMIN_TTL_HOURS * 60 * 60 * 1000);
  await db.insert(adminSessions).values({
    adminId,
    tokenHash: sha256(raw),
    ip: meta.ip,
    userAgent: meta.userAgent.slice(0, 250),
    expiresAt,
  });
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, adminId));
  const store = await cookies();
  store.set(ADMIN_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    expires: expiresAt,
  });
}

export async function revokeAdminSession() {
  const store = await cookies();
  const raw = store.get(ADMIN_COOKIE)?.value;
  if (raw) {
    await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.tokenHash, sha256(raw)));
  }
  store.delete(ADMIN_COOKIE);
  store.delete(PENDING_COOKIE);
}

export async function setPendingTwoFactor(adminId: number) {
  const token = createSignedToken({ adminId, scope: "admin-2fa" }, 5 * 60);
  const store = await cookies();
  store.set(PENDING_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: 5 * 60,
  });
}

export async function readPendingTwoFactor(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(PENDING_COOKIE)?.value;
  if (!raw) return null;
  const payload = readSignedToken(raw);
  if (!payload || payload.scope !== "admin-2fa") return null;
  return Number(payload.adminId);
}

export async function clearPendingTwoFactor() {
  const store = await cookies();
  store.delete(PENDING_COOKIE);
}

/* ------------------------------ rate limiting ------------------------------- */

export async function registerLoginAttempt(identifier: string, success: boolean, scope = "admin") {
  const meta = await requestMeta();
  await db.insert(loginAttempts).values({ scope, identifier: identifier.toLowerCase().slice(0, 190), ip: meta.ip, success });
}

export async function isRateLimited(identifier: string, scope = "admin"): Promise<boolean> {
  const meta = await requestMeta();
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.success, false),
        eq(loginAttempts.scope, scope),
        gte(loginAttempts.createdAt, since),
        or(eq(loginAttempts.identifier, identifier.toLowerCase()), eq(loginAttempts.ip, meta.ip)),
      ),
    );
  return (rows[0]?.count ?? 0) >= 6;
}

/* -------------------------------- customers -------------------------------- */

export async function getCustomerSession(): Promise<CustomerIdentity | null> {
  const store = await cookies();
  const raw = store.get(CUSTOMER_COOKIE)?.value;
  if (!raw) return null;
  const rows = await db
    .select({ customer: customers })
    .from(customerSessions)
    .innerJoin(customers, eq(customerSessions.customerId, customers.id))
    .where(and(eq(customerSessions.tokenHash, sha256(raw)), gt(customerSessions.expiresAt, new Date())))
    .limit(1);
  const customer = rows[0]?.customer;
  if (!customer) return null;
  return { id: customer.id, email: customer.email, name: customer.name, locale: customer.locale, referralCode: customer.referralCode };
}

export async function createCustomerSession(customerId: number) {
  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + CUSTOMER_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(customerSessions).values({ customerId, tokenHash: sha256(raw), expiresAt });
  const store = await cookies();
  store.set(CUSTOMER_COOKIE, raw, { httpOnly: true, sameSite: "lax", secure: isProd, path: "/", expires: expiresAt });
}

export async function revokeCustomerSession() {
  const store = await cookies();
  const raw = store.get(CUSTOMER_COOKIE)?.value;
  if (raw) await db.delete(customerSessions).where(eq(customerSessions.tokenHash, sha256(raw)));
  store.delete(CUSTOMER_COOKIE);
}

/* --------------------------------- auditing -------------------------------- */

export async function writeAudit(
  action: string,
  entity: string,
  entityId: string | number | null,
  detail: Record<string, unknown> = {},
  actor = "owner",
) {
  const meta = await requestMeta();
  await db.insert(auditLogs).values({
    actor,
    action,
    entity,
    entityId: entityId === null ? null : String(entityId),
    detail,
    ip: meta.ip,
  });
}
