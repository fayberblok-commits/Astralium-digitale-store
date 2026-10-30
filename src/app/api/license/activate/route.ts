import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { activateLicenseKey, createRateLimiter } from "../../../../lib/license";
import { hashIp } from "../../../../lib/fraud";

export const runtime = "nodejs";

/**
 * Public license activation (Phase 5, feature 18). Binds a device id
 * (stored only as a SHA-256 hash) to the key, up to the key's activation
 * limit. Re-activating the same device is idempotent. Rate-limited per
 * IP (10/min, in-memory per instance).
 */
const limiter = createRateLimiter(10, 60_000);

export async function POST(req: NextRequest) {
  if (!(await getFlag("license_keys"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 403 });
  }
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const gate = limiter.hit(hashIp(ip));
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) } },
    );
  }
  const body = (await req.json().catch(() => null)) as { key?: string; deviceId?: string } | null;
  if (!body?.key || !body?.deviceId) {
    return NextResponse.json({ error: "KEY_AND_DEVICE_REQUIRED" }, { status: 400 });
  }
  const verdict = await activateLicenseKey(body.key, body.deviceId);
  return NextResponse.json({
    valid: verdict.code === "OK",
    code: verdict.code,
    productId: verdict.productId,
    activationsUsed: verdict.activationsUsed,
    activationLimit: verdict.activationLimit,
    activationsRemaining: verdict.activationsRemaining,
    alreadyActivated: verdict.alreadyActivated ?? false,
  });
}
