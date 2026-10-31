/**
 * Startup environment validation.
 *
 * Validates the *format* of keys that are present and the *completeness*
 * of key groups that are partially present (notably S3). Absent optional
 * keys are never an error — the store is designed to run with zero env.
 * This runs once at server startup via src/instrumentation.ts and only
 * logs; it never throws, so a mis-typed optional key degrades a feature
 * instead of taking the whole store down.
 *
 * Phase 1 upgrade (§5): the security variables are validated with zod,
 * and in production, WEAK secrets become errors (the runtime also
 * refuses them — see lib/keys.ts / lib/admin.ts): a too-short
 * ADMIN_PASSWORD, a weak DOWNLOAD_SIGNING_SECRET or a short AUTH_SECRET
 * must be loud at boot, not discovered during an incident.
 */

import { z } from "zod";

export interface EnvCheck {
  errors: string[];
  warnings: string[];
  summary: string[];
}

const S3_KEYS = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

function isUrl(v: string): boolean {
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

/** zod schema for the Phase 1 security variables (all optional). */
const securityEnvSchema = z.object({
  TRUSTED_PROXY_HEADER: z
    .string()
    .regex(/^[a-zA-Z0-9-]+$/, "must be a valid HTTP header name")
    .optional(),
  ADMIN_PATH: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, "must be a URL slug (lowercase letters, digits, dashes)")
    .optional(),
  ADMIN_SESSION_IDLE_MINUTES: z
    .string()
    .regex(/^\d+$/, "must be a whole number of minutes")
    .optional(),
  ADMIN_TOTP_REQUIRED: z.enum(["0", "1", "true", "false"]).optional(),
  ADMIN_ALERT_EMAIL: z.string().email("must be an email address").optional(),
  AUTH_SECRET: z.string().optional(),
  BACKUP_ENCRYPTION_KEY: z.string().optional(),
});

export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const present = (k: string) => Boolean(env[k] && env[k]!.trim().length > 0);
  const production = env.NODE_ENV === "production";

  // ── Database ──────────────────────────────────────────────────────────────
  if (present("DATABASE_URL") && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL!)) {
    errors.push("DATABASE_URL is set but does not start with postgresql:// — check the connection string.");
  }

  // ── S3 storage: all-or-nothing group ─────────────────────────────────────
  const s3Present = S3_KEYS.filter(present);
  if (s3Present.length > 0 && s3Present.length < S3_KEYS.length) {
    const missing = S3_KEYS.filter((k) => !present(k));
    errors.push(`S3 storage is partially configured (missing: ${missing.join(", ")}) — file uploads/downloads stay disabled until the group is complete.`);
  }
  if (present("S3_ENDPOINT") && !isUrl(env.S3_ENDPOINT!)) {
    errors.push("S3_ENDPOINT is set but is not a valid URL.");
  }
  if (present("S3_FORCE_PATH_STYLE") && !["1", "0", "true", "false"].includes(env.S3_FORCE_PATH_STYLE!)) {
    warnings.push("S3_FORCE_PATH_STYLE should be one of 1/0/true/false.");
  }

  // ── URLs ──────────────────────────────────────────────────────────────────
  if (present("NEXT_PUBLIC_SITE_URL") && !isUrl(env.NEXT_PUBLIC_SITE_URL!)) {
    errors.push("NEXT_PUBLIC_SITE_URL is set but is not a valid URL.");
  }

  // ── Payments / misc format hints (warnings only) ─────────────────────────
  if (present("STRIPE_SECRET_KEY") && !env.STRIPE_SECRET_KEY!.startsWith("sk_")) {
    warnings.push("STRIPE_SECRET_KEY does not start with sk_ — check you pasted the secret key, not the publishable one.");
  }
  if (present("ADMIN_PASSWORD") && env.ADMIN_PASSWORD!.length < 8) {
    warnings.push("ADMIN_PASSWORD is shorter than 8 characters — admin login stays disabled.");
  }
  if (present("DOWNLOAD_SIGNING_SECRET") && env.DOWNLOAD_SIGNING_SECRET!.length < 32) {
    warnings.push("DOWNLOAD_SIGNING_SECRET is shorter than 32 characters — use a longer random string.");
  }

  // ── Social delivery (Phase 2): partial groups warn, never error ────────
  const waKeys = ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_NUMBER"] as const;
  const waPresent = waKeys.filter(present);
  if (waPresent.length > 0 && waPresent.length < waKeys.length) {
    warnings.push(`WhatsApp delivery is partially configured (missing: ${waKeys.filter((k) => !present(k)).join(", ")}) — the channel stays hidden until the group is complete.`);
  }
  const metaKeys = ["META_APP_SECRET", "META_PAGE_ID", "META_PAGE_ACCESS_TOKEN", "INSTAGRAM_USERNAME", "INSTAGRAM_ACCESS_TOKEN"] as const;
  const metaPresent = metaKeys.filter(present);
  if (metaPresent.length > 0 && metaPresent.length < metaKeys.length) {
    warnings.push(`Meta delivery is partially configured (missing: ${metaKeys.filter((k) => !present(k)).join(", ")}) — Messenger/Instagram delivery stays hidden until the group is complete.`);
  }
  if (present("PII_ENCRYPTION_KEY") && env.PII_ENCRYPTION_KEY!.length < 16) {
    warnings.push("PII_ENCRYPTION_KEY is shorter than 16 characters — phone encryption for delivery stays disabled.");
  }
  // ── Phase 5: watermark fetch cap format hint ────────────────────────────
  if (present("WATERMARK_MAX_MB") && !(Number(env.WATERMARK_MAX_MB) > 0)) {
    warnings.push("WATERMARK_MAX_MB is not a positive number — the 50 MB default applies.");
  }

  // ── Phase 1 upgrade (§5): security variables via zod ─────────────────────
  const securityCandidate: Record<string, string> = {};
  for (const key of [
    "TRUSTED_PROXY_HEADER", "ADMIN_PATH", "ADMIN_SESSION_IDLE_MINUTES",
    "ADMIN_TOTP_REQUIRED", "ADMIN_ALERT_EMAIL", "AUTH_SECRET", "BACKUP_ENCRYPTION_KEY",
  ] as const) {
    if (present(key)) securityCandidate[key] = env[key]!;
  }
  const secParsed = securityEnvSchema.safeParse(securityCandidate);
  if (!secParsed.success) {
    for (const issue of secParsed.error.issues) {
      const key = String(issue.path[0] ?? "env");
      // Format problems in routing-shaping vars are errors (they would
      // silently change security behavior); the rest are warnings.
      if (key === "TRUSTED_PROXY_HEADER" || key === "ADMIN_PATH") {
        errors.push(`${key} ${issue.message}.`);
      } else {
        warnings.push(`${key} ${issue.message}.`);
      }
    }
  }
  // Weak-secret escalation in production (runtime refusal is the backstop).
  if (production && present("ADMIN_PASSWORD") && env.ADMIN_PASSWORD!.length < 12) {
    errors.push("ADMIN_PASSWORD is shorter than 12 characters — in production the admin login is REFUSED until it is strengthened.");
  }
  if (production && present("DOWNLOAD_SIGNING_SECRET") && env.DOWNLOAD_SIGNING_SECRET!.length < 32) {
    errors.push("DOWNLOAD_SIGNING_SECRET is weak (< 32 chars) — in production it is REFUSED and an ephemeral per-boot key is used instead; set a long random secret.");
  }
  if (production && !present("DOWNLOAD_SIGNING_SECRET") && !present("AUTH_SECRET")) {
    warnings.push("Neither DOWNLOAD_SIGNING_SECRET nor AUTH_SECRET is set — download tokens use an ephemeral per-boot key and stop verifying on restart. Set DOWNLOAD_SIGNING_SECRET for production.");
  }
  if (present("AUTH_SECRET") && env.AUTH_SECRET!.length < 32) {
    const msg = "AUTH_SECRET is shorter than 32 characters — use a long random string for key derivation.";
    if (production) errors.push(msg);
    else warnings.push(msg);
  }
  if (present("BACKUP_ENCRYPTION_KEY") && env.BACKUP_ENCRYPTION_KEY!.length < 32) {
    warnings.push("BACKUP_ENCRYPTION_KEY is shorter than 32 characters — database backups will refuse to run until it is strengthened.");
  }
  // Captcha partial groups (secret without site key or vice versa).
  const turnstileSecret = present("TURNSTILE_SECRET_KEY");
  const turnstileSite = present("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  if (turnstileSecret !== turnstileSite) {
    warnings.push("Turnstile is partially configured — set both TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY (server verification works with the secret alone; the widget needs the site key).");
  }
  const hcaptchaSecret = present("HCAPTCHA_SECRET_KEY");
  const hcaptchaSite = present("NEXT_PUBLIC_HCAPTCHA_SITE_KEY");
  if (hcaptchaSecret !== hcaptchaSite) {
    warnings.push("hCaptcha is partially configured — set both HCAPTCHA_SECRET_KEY and NEXT_PUBLIC_HCAPTCHA_SITE_KEY.");
  }

  // ── Phase 5 upgrade: AI gateway variables via zod ────────────────────────
  // Keys live ONLY here (env). With no key the AI staff stays hidden and
  // the deterministic grounded engine answers — never a fake AI.
  const aiEnvSchema = z.object({
    AI_PROVIDER: z.enum(["meta", "openai", "mock"]).optional(),
    AI_META_BASE_URL: z.string().url("must be a valid URL").optional(),
    AI_META_MODEL: z.string().min(1).max(120).optional(),
    AI_FALLBACK_BASE_URL: z.string().url("must be a valid URL").optional(),
    AI_FALLBACK_MODEL: z.string().min(1).max(120).optional(),
    AI_DAILY_COST_CAP_USD: z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative number").optional(),
    AI_DAILY_ACTION_CAP: z.string().regex(/^\d+$/, "must be a whole number").optional(),
  });
  const aiCandidate: Record<string, string> = {};
  for (const key of [
    "AI_PROVIDER", "AI_META_BASE_URL", "AI_META_MODEL",
    "AI_FALLBACK_BASE_URL", "AI_FALLBACK_MODEL",
    "AI_DAILY_COST_CAP_USD", "AI_DAILY_ACTION_CAP",
  ] as const) {
    if (present(key)) aiCandidate[key] = env[key]!;
  }
  const aiParsed = aiEnvSchema.safeParse(aiCandidate);
  if (!aiParsed.success) {
    for (const issue of aiParsed.error.issues) {
      warnings.push(`${String(issue.path[0] ?? "AI")} ${issue.message}.`);
    }
  }
  if (env.AI_PROVIDER === "mock" && production) {
    warnings.push("AI_PROVIDER=mock in production — the deterministic MOCK provider is selected; no real model answers. Set AI_PROVIDER=meta (with MODEL_API_KEY) for production AI staff.");
  }
  const aiConfigured = present("MODEL_API_KEY") || present("AI_FALLBACK_API_KEY") || present("OPENAI_API_KEY") || env.AI_PROVIDER === "mock";

  const on = (label: string, ok: boolean) => `${ok ? "on " : "off"}  ${label}`;
  const summary = [
    "[astralium] environment summary:",
    `  ${on("database (PostgreSQL)", present("DATABASE_URL") && errors.every((e) => !e.startsWith("DATABASE_URL")))}`,
    `  ${on("file storage (S3)", s3Present.length === S3_KEYS.length)}`,
    `  ${on("Stripe", present("STRIPE_SECRET_KEY"))}`,
    `  ${on("PayPal", present("PAYPAL_CLIENT_ID") && present("PAYPAL_CLIENT_SECRET"))}`,
    `  ${on("email (Resend)", present("RESEND_API_KEY"))}`,
    `  ${on("admin", present("ADMIN_PASSWORD") && env.ADMIN_PASSWORD!.length >= 8)}`,
    `  ${on("WhatsApp delivery", waPresent.length === waKeys.length)}`,
    `  ${on("Messenger/Instagram delivery", metaPresent.length === metaKeys.length)}`,
    `  ${on("PII encryption", present("PII_ENCRYPTION_KEY"))}`,
    `  ${on("captcha (Turnstile/hCaptcha)", turnstileSecret || hcaptchaSecret)}`,
    `  ${on("admin TOTP required", env.ADMIN_TOTP_REQUIRED === "1" || env.ADMIN_TOTP_REQUIRED === "true")}`,
    `  ${on("AI staff gateway (Meta Model API / fallback)", aiConfigured)}`,
  ];
  return { errors, warnings, summary };
}

export function logEnvSummary(): void {
  try {
    const { errors, warnings, summary } = validateEnv();
    for (const line of summary) console.log(line);
    for (const w of warnings) console.warn(`[astralium] env warning: ${w}`);
    for (const e of errors) console.error(`[astralium] env error: ${e}`);
  } catch {
    // Validation must never take the server down.
  }
}
