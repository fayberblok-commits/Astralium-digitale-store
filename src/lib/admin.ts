/**
 * Admin session (bootstrap owner) — Phase 1 upgrade, security §4/§5.
 *
 * The pre-upgrade cookie was a bare HMAC of a fixed label keyed by
 * ADMIN_PASSWORD: no expiry, no idle timeout, no revocation short of
 * rotating the password, and the password itself was the signing key.
 * The v3 session is a signed payload token:
 *
 *   v3.<base64url JSON>.<HMAC>   payload { sub, role, iat, exp, epoch, scope }
 *
 * signed with the HKDF-derived "admin-session" purpose key (lib/keys.ts
 * — the password is never the direct signing key). Properties:
 *  - absolute expiry (default 8h) AND an idle timeout (default 60 min
 *    since issue; POST /api/admin/session/refresh rotates the token,
 *    which is also the session-rotation mechanism),
 *  - `epoch` binds the token to the durable session epoch
 *    (lib/security-state.ts): "terminate all sessions" bumps the epoch
 *    and every outstanding token dies,
 *  - `scope: "setup"` tokens (issued when ADMIN_TOTP_REQUIRED=1 and the
 *    owner has not enrolled TOTP yet) can only reach the self-service
 *    enrollment endpoints — enforced in team.ts requireAdmin.
 *
 * The legacy fixed-label token is REJECTED (it had no expiry at all);
 * the owner simply logs in again. Weak ADMIN_PASSWORD values are
 * refused in production (< 12 chars disables admin + startup error).
 */
import { timingSafeEqual } from "node:crypto";
import { purposeHmac, purposeHmacVerify } from "./keys.ts";

export const ADMIN_COOKIE = "astralium-admin";
export const STEPUP_COOKIE = "astralium-stepup";

export const ADMIN_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const STEPUP_TTL_MS = 5 * 60 * 1000;

export function adminSessionIdleMs(): number {
  const mins = Number(process.env.ADMIN_SESSION_IDLE_MINUTES);
  return (Number.isFinite(mins) && mins > 0 ? mins : 60) * 60 * 1000;
}

export function adminConfigured(): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  // Weak-secret refusal (production): a short admin password disables
  // the admin area entirely rather than "protecting" it weakly.
  if (process.env.NODE_ENV === "production" && pw.length < 12) return false;
  return pw.length >= 8;
}

export function checkAdminPassword(candidate: string): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(pw);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── v3 session tokens ───────────────────────────────────────────────────────

export interface AdminSessionPayload {
  v: 3;
  sub: "bootstrap-owner";
  role: "owner";
  iat: number;
  exp: number;
  epoch: number;
  scope: "full" | "setup";
}

export function createAdminSession(opts: {
  epoch: number;
  scope?: "full" | "setup";
  nowMs?: number;
}): string | null {
  const now = opts.nowMs ?? Date.now();
  const payload: AdminSessionPayload = {
    v: 3,
    sub: "bootstrap-owner",
    role: "owner",
    iat: now,
    exp: now + ADMIN_SESSION_ABSOLUTE_MS,
    epoch: opts.epoch,
    scope: opts.scope ?? "full",
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = purposeHmac("admin-session", `v3.${body}`);
  if (!sig) return null;
  return `v3.${body}.${sig}`;
}

export function parseAdminSession(token: string | undefined, nowMs: number = Date.now()): AdminSessionPayload | null {
  if (!token || !token.startsWith("v3.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  if (!purposeHmacVerify("admin-session", `v3.${parts[1]}`, parts[2])) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as AdminSessionPayload;
    if (payload.v !== 3 || payload.sub !== "bootstrap-owner" || payload.role !== "owner") return null;
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number" || typeof payload.epoch !== "number") return null;
    if (payload.exp < nowMs) return null; // absolute expiry
    if (nowMs - payload.iat > adminSessionIdleMs()) return null; // idle timeout
    if (payload.scope !== "full" && payload.scope !== "setup") return null;
    return payload;
  } catch {
    return null;
  }
}

export function isAdminSession(cookieValue: string | undefined): boolean {
  return parseAdminSession(cookieValue) !== null;
}

// ─── Step-up tokens (re-auth proof for financial/sensitive actions) ─────────

export interface StepUpPayload {
  sub: string; // actor key the step-up was granted to
  exp: number;
}

export function createStepUpToken(actorKey: string, nowMs: number = Date.now()): string | null {
  const payload: StepUpPayload = { sub: actorKey, exp: nowMs + STEPUP_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = purposeHmac("step-up", `su.${body}`);
  if (!sig) return null;
  return `su.${body}.${sig}`;
}

export function verifyStepUpToken(token: string | undefined, actorKey: string, nowMs: number = Date.now()): boolean {
  if (!token || !token.startsWith("su.")) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  if (!purposeHmacVerify("step-up", `su.${parts[1]}`, parts[2])) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as StepUpPayload;
    return payload.sub === actorKey && typeof payload.exp === "number" && payload.exp >= nowMs;
  } catch {
    return false;
  }
}

/** Which integration env keys are present — presence only, never values. */
export function providerStatus(): { name: string; ready: boolean; missing: string[] }[] {
  const has = (k: string) => Boolean(process.env[k]);
  const group = (name: string, keys: string[]) => ({
    name,
    ready: keys.every(has),
    missing: keys.filter((k) => !has(k)),
  });
  return [
    group("Database (PostgreSQL)", ["DATABASE_URL"]),
    group("File storage (S3)", ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]),
    group("Stripe", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]),
    group("PayPal", ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"]),
    group("Email (Resend)", ["RESEND_API_KEY", "EMAIL_FROM"]),
    group("WhatsApp delivery", ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_NUMBER", "META_APP_SECRET"]),
    group("Messenger delivery", ["META_PAGE_ID", "META_PAGE_ACCESS_TOKEN", "META_APP_SECRET"]),
    group("Instagram delivery", ["INSTAGRAM_USERNAME", "INSTAGRAM_ACCESS_TOKEN", "META_APP_SECRET"]),
    group("PII encryption", ["PII_ENCRYPTION_KEY"]),
    group("AI support (OpenAI)", ["OPENAI_API_KEY"]),
    group("Download signing", ["DOWNLOAD_SIGNING_SECRET"]),
    group("Admin", ["ADMIN_PASSWORD"]),
  ];
}
