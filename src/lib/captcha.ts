/**
 * Bot protection (Phase 1 upgrade, security §10): Cloudflare Turnstile
 * or hCaptcha, verified server-side against the provider's siteverify
 * endpoint.
 *
 * Honesty contract: with NO provider keys configured the check reports
 * { configured: false } and routes let the request through with the
 * other defences (rate limits) — the module NEVER pretends a check
 * happened. The first time a protected form is hit while unconfigured,
 * a clear log line says so. Once keys exist, a missing/invalid token
 * is a hard rejection.
 *
 * Configuration (any one provider):
 *   TURNSTILE_SECRET_KEY (+ NEXT_PUBLIC_TURNSTILE_SITE_KEY for the widget)
 *   HCAPTCHA_SECRET_KEY  (+ NEXT_PUBLIC_HCAPTCHA_SITE_KEY for the widget)
 */

export type CaptchaProvider = "turnstile" | "hcaptcha";

export function captchaProvider(): CaptchaProvider | null {
  if (process.env.TURNSTILE_SECRET_KEY) return "turnstile";
  if (process.env.HCAPTCHA_SECRET_KEY) return "hcaptcha";
  return null;
}

export function captchaSiteKey(): { provider: CaptchaProvider; siteKey: string } | null {
  if (process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    return { provider: "turnstile", siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY };
  }
  if (process.env.HCAPTCHA_SECRET_KEY && process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY) {
    return { provider: "hcaptcha", siteKey: process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY };
  }
  return null;
}

export type CaptchaVerdict =
  | { configured: false }
  | { configured: true; ok: true }
  | { configured: true; ok: false; reason: string };

let warnedUnconfigured = false;

/**
 * Verify a captcha token. `token` is the value the widget produced
 * (cf-turnstile-response / h-captcha-response, passed through by the
 * form). Fails CLOSED when configured: network errors and provider
 * rejections are both "not ok".
 */
export async function verifyCaptcha(token: string | undefined | null, remoteIp?: string): Promise<CaptchaVerdict> {
  const provider = captchaProvider();
  if (!provider) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[astralium] captcha NOT configured (set TURNSTILE_SECRET_KEY or HCAPTCHA_SECRET_KEY) — " +
          "public forms are protected by rate limits only. This is logged once per process.",
      );
    }
    return { configured: false };
  }
  if (!token) return { configured: true, ok: false, reason: "TOKEN_MISSING" };
  const secret = provider === "turnstile" ? process.env.TURNSTILE_SECRET_KEY! : process.env.HCAPTCHA_SECRET_KEY!;
  const url =
    provider === "turnstile"
      ? "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      : "https://api.hcaptcha.com/siteverify";
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) return { configured: true, ok: false, reason: `VERIFY_HTTP_${res.status}` };
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success) return { configured: true, ok: true };
    return { configured: true, ok: false, reason: (data["error-codes"] ?? ["REJECTED"]).join(",") };
  } catch {
    return { configured: true, ok: false, reason: "VERIFY_NETWORK_ERROR" };
  }
}

/** Route helper: returns a 403 Response when a configured captcha fails, else null. */
export async function captchaGate(
  token: string | undefined | null,
  remoteIp?: string,
): Promise<Response | null> {
  const verdict = await verifyCaptcha(token, remoteIp);
  if (verdict.configured && !verdict.ok) {
    return new Response(JSON.stringify({ error: "CAPTCHA_FAILED", reason: verdict.reason }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
