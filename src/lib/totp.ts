/**
 * TOTP two-factor authentication (Phase 6, feature 29) — dependency-free
 * implementation of RFC 4226 (HOTP) / RFC 6238 (TOTP) with HMAC-SHA1,
 * verified against the RFC 6238 Appendix B test vectors in
 * tests/phase6-team.test.mjs.
 *
 * Secrets are RFC 4648 base32 (the format authenticator apps expect).
 * Verification accepts a ±1 step window for clock skew and is
 * replay-safe: the caller persists the last accepted step
 * (`AdminUser.totpLastStep`) and passes it back in — a code whose step
 * is not strictly newer is rejected even inside the window.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** New random TOTP secret (20 bytes → 32 base32 chars), authenticator-ready. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP: counter-based one-time password (RFC 4226 dynamic truncation). */
export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, "0");
}

/** The 30-second step containing a timestamp. */
export function totpStep(atMs: number): number {
  return Math.floor(atMs / 1000 / 30);
}

/** TOTP for a moment in time (defaults to now, 6 digits). */
export function totp(secretBase32: string, atMs: number = Date.now(), digits = 6): string {
  return hotp(secretBase32, totpStep(atMs), digits);
}

export interface TotpVerifyResult {
  ok: boolean;
  /** The matched step when ok — persist it to defeat replay. */
  step: number | null;
}

/**
 * Verify a code with a ±`window` step tolerance. When `lastUsedStep` is
 * provided, the matched step must be strictly greater — the same code
 * can never be accepted twice, and neither can an older one.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { atMs?: number; window?: number; lastUsedStep?: number | null; digits?: number } = {},
): TotpVerifyResult {
  const clean = (code ?? "").replace(/[^0-9]/g, "");
  const digits = opts.digits ?? 6;
  if (clean.length !== digits) return { ok: false, step: null };
  const atMs = opts.atMs ?? Date.now();
  const window = opts.window ?? 1;
  const current = totpStep(atMs);
  const candidate = Buffer.from(clean);
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (step < 0) continue;
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const expected = Buffer.from(hotp(secretBase32, step, digits));
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      return { ok: true, step };
    }
  }
  return { ok: false, step: null };
}

/** otpauth:// URI for authenticator apps (rendered as text + optional QR). */
export function otpauthUri(params: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const qs = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${qs.toString()}`;
}
