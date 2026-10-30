/**
 * Startup environment validation.
 *
 * Validates the *format* of keys that are present and the *completeness* of
 * key groups that are partially present (notably S3). Absent optional keys
 * are never an error — the store is designed to run with zero env. This runs
 * once at server startup via src/instrumentation.ts and only logs; it never
 * throws, so a mis-typed optional key degrades a feature instead of taking
 * the whole store down.
 */

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

export function validateEnv(env: NodeJS.ProcessEnv = process.env): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const present = (k: string) => Boolean(env[k] && env[k]!.trim().length > 0);

  // ── Database ──────────────────────────────────────────────────────────────
  if (present("DATABASE_URL") && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL!)) {
    errors.push("DATABASE_URL is set but does not start with postgres:// or postgresql:// — DB features will stay disabled.");
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
