/**
 * Signed download tokens (HMAC-SHA256).
 *
 * Token = base64url(JSON payload) + "." + base64url(HMAC(payload)).
 * Payload: { pid, oid, exp (unix seconds), max (max downloads), n (nonce) }.
 * Pure Node crypto — no SDK, fully unit-testable.
 *
 * Phase 1 upgrade (key separation, lib/keys.ts): tokens are now signed
 * with the HKDF-derived "download-token" purpose key (KEY_VERSION 2).
 * Verification additionally accepts the PRE-UPGRADE signature (raw
 * HMAC with DOWNLOAD_SIGNING_SECRET) so download links already emailed
 * to buyers keep working until they expire; the legacy development
 * default is accepted only outside production. In production with no
 * strong secret configured, signing uses an ephemeral per-boot key
 * (see keys.ts) — never the public legacy default.
 */
import { randomBytes } from "node:crypto";
import { legacyHmacVerify, purposeHmac, purposeHmacVerify, LEGACY_DEV_SECRET } from "./keys.ts";

export interface DownloadTokenPayload {
  pid: string; // product id
  oid: string; // order id
  exp: number; // unix seconds
  max: number; // max downloads allowed
  n: string; // nonce
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string): string {
  const sig = purposeHmac("download-token", data);
  if (!sig) throw new Error("DOWNLOAD_SIGNING_NOT_AVAILABLE");
  return sig;
}

export function createDownloadToken(
  productId: string,
  orderId: string,
  opts: { ttlSeconds?: number; maxDownloads?: number } = {},
): string {
  const payload: DownloadTokenPayload = {
    pid: productId,
    oid: orderId,
    exp: Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? 7 * 24 * 3600),
    max: opts.maxDownloads ?? 5,
    n: randomBytes(6).toString("hex"),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { ok: true; payload: DownloadTokenPayload }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

function signatureValid(body: string, signature: string): boolean {
  // Current (HKDF purpose key, v2).
  if (purposeHmacVerify("download-token", body, signature)) return true;
  // Legacy pre-upgrade: raw HMAC keyed by the configured secret.
  const raw = process.env.DOWNLOAD_SIGNING_SECRET;
  if (raw && legacyHmacVerify(raw, body, signature)) return true;
  // Legacy development default — outside production only.
  if (process.env.NODE_ENV !== "production" && legacyHmacVerify(LEGACY_DEV_SECRET, body, signature)) {
    return true;
  }
  return false;
}

export function verifyDownloadToken(token: string, nowSeconds?: number): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;
  if (!signatureValid(body, signature)) {
    return { ok: false, reason: "bad-signature" };
  }
  let payload: DownloadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DownloadTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload.pid || !payload.oid || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
