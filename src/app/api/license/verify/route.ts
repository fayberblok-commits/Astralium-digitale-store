import { NextRequest, NextResponse } from "next/server";
import { getFlag } from "../../../../lib/flags";
import { createRateLimiter, verifyLicenseKey } from "../../../../lib/license";
import { hashIp } from "../../../../lib/fraud";

export const runtime = "nodejs";

/**
 * Public license verification (Phase 5, feature 18). Rate-limited per
 * IP (30/min, in-memory per instance). Distinct failure codes:
 * KEY_NOT_FOUND / KEY_REVOKED / ACTIVATION_LIMIT_REACHED. Verification
 * never consumes an activation.
 */
const limiter = createRateLimiter(30, 60_000);

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
  const body = (await req.json().catch(() => null)) as { key?: string } | null;
  if (!body?.key) return NextResponse.json({ error: "KEY_REQUIRED" }, { status: 400 });
  const verdict = await verifyLicenseKey(body.key);
  return NextResponse.json({
    valid: verdict.code === "OK",
    code: verdict.code,
    productId: verdict.productId,
    activationsUsed: verdict.activationsUsed,
    activationLimit: verdict.activationLimit,
    activationsRemaining: verdict.activationsRemaining,
  });
}
