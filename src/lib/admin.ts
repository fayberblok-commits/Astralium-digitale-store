/**
 * Admin session: the session cookie is an HMAC of a fixed label keyed by
 * ADMIN_PASSWORD itself, so sessions invalidate automatically when the
 * password rotates. Compared in constant time. If ADMIN_PASSWORD is unset
 * the admin area is disabled entirely.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "astralium-admin";
const LABEL = "astralium-admin-session-v1";

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8);
}

export function adminSessionToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHmac("sha256", pw).update(LABEL).digest("base64url");
}

export function checkAdminPassword(candidate: string): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(pw);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdminSession(cookieValue: string | undefined): boolean {
  const expected = adminSessionToken();
  if (!expected || !cookieValue) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
    group("AI support (OpenAI)", ["OPENAI_API_KEY"]),
    group("Download signing", ["DOWNLOAD_SIGNING_SECRET"]),
    group("Admin", ["ADMIN_PASSWORD"]),
  ];
}
