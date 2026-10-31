/**
 * Key separation (Phase 1 upgrade, security §5).
 *
 * Before this module, every subsystem HMAC'd with whichever raw env
 * secret was nearest (ADMIN_PASSWORD for sessions, DOWNLOAD_SIGNING_SECRET
 * for tokens and claim refs) — one leaked secret compromised all of
 * them, and rotating one broke the others. Now each purpose gets its own
 * key, derived from a master secret with HKDF-SHA256 (RFC 5869):
 *
 *   derived = HKDF(master, salt="astralium:<KEY_VERSION>",
 *                  info="purpose:<purpose>", 32 bytes)
 *
 * Masters (first set wins, per purpose family):
 *   download-token / claim-code / order-access:
 *       AUTH_SECRET → DOWNLOAD_SIGNING_SECRET
 *   admin-session / team-session / step-up:
 *       AUTH_SECRET → ADMIN_PASSWORD
 *
 * AUTH_SECRET is the recommended dedicated master: set it once and
 * DOWNLOAD_SIGNING_SECRET / ADMIN_PASSWORD keep working as fallbacks so
 * existing deployments keep verifying previously issued tokens
 * (tokens.ts additionally accepts the pre-HKDF legacy signature when
 * DOWNLOAD_SIGNING_SECRET is the master, for tokens emailed before this
 * upgrade — see docs/SECURITY.md for the rotation procedure).
 *
 * KEY_VERSION is embedded in the HKDF salt: bump it (and follow the
 * rotation procedure in docs/SECURITY.md) to invalidate every derived
 * key at once without changing any master secret.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export const KEY_VERSION = 2;

export type KeyPurpose =
  | "download-token"
  | "claim-code"
  | "order-access"
  | "admin-session"
  | "team-session"
  | "step-up"
  // Phase 4 upgrade: AES key for the owner's bank-details vault
  // (Manager's Office). Admin family — derived from AUTH_SECRET →
  // ADMIN_PASSWORD like the other admin purposes, never from the
  // download family.
  | "bank-vault";

/** The pre-upgrade hard-coded development fallback. Never valid in production. */
export const LEGACY_DEV_SECRET = "dev-only-insecure-signing-secret-change-me-0123456789";

const DOWNLOAD_FAMILY: KeyPurpose[] = ["download-token", "claim-code", "order-access"];

function masterFor(purpose: KeyPurpose): string | null {
  const auth = process.env.AUTH_SECRET?.trim();
  if (DOWNLOAD_FAMILY.includes(purpose)) {
    return auth || process.env.DOWNLOAD_SIGNING_SECRET?.trim() || null;
  }
  return auth || process.env.ADMIN_PASSWORD || null;
}

/**
 * Weak-secret detection for signing-class secrets: too short, a known
 * placeholder/default, or trivially low variety. Used by startup
 * validation (refuse in production) and by tokens.ts (never sign with a
 * weak secret in production — fall back to an ephemeral per-boot key).
 */
const KNOWN_WEAK = new Set([
  LEGACY_DEV_SECRET,
  "change-me",
  "changeme",
  "secret",
  "password",
  "letmein",
  "dev-only-insecure-signing-secret",
]);

export function isWeakSecret(value: string | undefined | null, minLength = 32): boolean {
  if (!value) return true;
  const v = value.trim();
  if (v.length < minLength) return true;
  if (KNOWN_WEAK.has(v.toLowerCase())) return true;
  // Low-variety strings ("aaaa…", "abcabcabc…") have no real entropy.
  const distinct = new Set(v).size;
  if (distinct < 8) return true;
  if (/^(.)\1+$/.test(v)) return true;
  return false;
}

export type SecretStatus = "ok" | "missing" | "weak";

export function downloadSecretStatus(): SecretStatus {
  const v = process.env.AUTH_SECRET || process.env.DOWNLOAD_SIGNING_SECRET;
  if (!v || !v.trim()) return "missing";
  return isWeakSecret(v) ? "weak" : "ok";
}

// ─── HKDF derivation ─────────────────────────────────────────────────────────

const derivedCache = new Map<string, Buffer>();

export function deriveKey(purpose: KeyPurpose): Buffer | null {
  const master = masterFor(purpose);
  if (!master) return null;
  const cacheKey = `${purpose}:${master.length}:${master.slice(0, 4)}`;
  const hit = derivedCache.get(cacheKey);
  if (hit) return hit;
  const key = Buffer.from(
    hkdfSync("sha256", master, `astralium:v${KEY_VERSION}`, `purpose:${purpose}`, 32),
  );
  derivedCache.set(cacheKey, key);
  return key;
}

// ─── Ephemeral per-boot fallback (download tokens only) ─────────────────────
// When NO signing secret is configured, production must never fall back
// to the public legacy default (anyone could forge tokens). Instead the
// process generates a random master at boot: tokens work for the life of
// the process, are unforgeable, and die on restart — a loud, safe
// degradation that startup validation reports as an error to fix.
let ephemeralMaster: string | null = null;
let ephemeralWarned = false;

export function ephemeralDownloadKey(): Buffer {
  if (!ephemeralMaster) {
    ephemeralMaster = randomBytes(32).toString("base64url");
    if (!ephemeralWarned) {
      ephemeralWarned = true;
      console.error(
        "[astralium] SECURITY: no strong DOWNLOAD_SIGNING_SECRET/AUTH_SECRET configured — " +
          "download tokens are signed with an ephemeral per-boot key and will stop verifying on restart. " +
          "Set a long random secret (see .env.example).",
      );
    }
  }
  return Buffer.from(
    hkdfSync("sha256", ephemeralMaster, `astralium:v${KEY_VERSION}`, "purpose:download-token", 32),
  );
}

/** The effective signing key for a purpose (null when unconfigured and no fallback applies). */
export function signingKey(purpose: KeyPurpose): Buffer | null {
  const derived = deriveKey(purpose);
  if (derived) {
    // In production, refuse to sign with a weak master: an attacker who
    // can read the (public) weak value could forge every token.
    const master = masterFor(purpose);
    if (process.env.NODE_ENV === "production" && purpose === "download-token" && isWeakSecret(master)) {
      return ephemeralDownloadKey();
    }
    return derived;
  }
  if (purpose === "download-token" && process.env.NODE_ENV === "production") {
    return ephemeralDownloadKey();
  }
  if (process.env.NODE_ENV !== "production" && DOWNLOAD_FAMILY.includes(purpose)) {
    // Development/test: historic behaviour — derive from the legacy dev
    // default, so local flows and the unit suites work with zero env.
    return Buffer.from(
      hkdfSync("sha256", LEGACY_DEV_SECRET, `astralium:v${KEY_VERSION}`, `purpose:${purpose}`, 32),
    );
  }
  return null;
}

export function purposeHmac(purpose: KeyPurpose, data: string): string | null {
  const key = signingKey(purpose);
  if (!key) return null;
  return createHmac("sha256", key).update(data).digest("base64url");
}

export function purposeHmacVerify(purpose: KeyPurpose, data: string, signature: string): boolean {
  const expected = purposeHmac(purpose, data);
  if (!expected) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Legacy pre-HKDF HMAC (raw secret as key) — verification only, for artifacts issued before this upgrade. */
export function legacyHmacVerify(secretValue: string, data: string, signature: string, encoding: "base64url" | "hex" = "base64url"): boolean {
  const expected = createHmac("sha256", secretValue).update(data).digest(encoding);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Test hook: forget cached derivations/ephemeral state (env changes between tests). */
export function __resetKeyCachesForTests(): void {
  derivedCache.clear();
  ephemeralMaster = null;
  ephemeralWarned = false;
}
