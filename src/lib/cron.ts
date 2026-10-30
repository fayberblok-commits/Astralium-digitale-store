/**
 * Shared cron-secret check for the /api/jobs/* endpoints (Phase 4).
 *
 * The scheduler must send the secret in the `x-cron-secret` header. The
 * generic CRON_SECRET is preferred; PRICE_ALERT_CRON_SECRET (Phase 3) is
 * accepted as a fallback so one secret can drive every job. Comparison
 * is constant-time (lib/pii.ts safeEqual). No secret configured → the
 * job refuses to run (never open).
 */
import type { NextRequest } from "next/server";
import { safeEqual } from "./pii.ts";

export type CronCheck = "ok" | "not-configured" | "unauthorized";

export function checkCronSecret(req: NextRequest): CronCheck {
  const secret = process.env.CRON_SECRET || process.env.PRICE_ALERT_CRON_SECRET;
  if (!secret) return "not-configured";
  const provided = req.headers.get("x-cron-secret") ?? "";
  return safeEqual(provided, secret) ? "ok" : "unauthorized";
}

export function cronErrorStatus(check: CronCheck): { error: string; status: number } {
  return check === "not-configured"
    ? { error: "CRON_SECRET_NOT_CONFIGURED", status: 503 }
    : { error: "UNAUTHORIZED", status: 401 };
}
