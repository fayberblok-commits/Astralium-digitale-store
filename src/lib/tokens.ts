/**
 * Signed download tokens (HMAC-SHA256).
 *
 * Token = base64url(JSON payload) + "." + base64url(HMAC(payload)).
 * Payload: { pid, oid, exp (unix seconds), max (max downloads), n (nonce) }.
 * Pure Node crypto — no SDK, fully unit-testable.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface DownloadTokenPayload {
  pid: string; // product id
  oid: string; // order id
  exp: number; // unix seconds
  max: number; // max downloads allowed
  n: string; // nonce
}

function secret(): string {
  return (
    process.env.DOWNLOAD_SIGNING_SECRET ||
    "dev-only-insecure-signing-secret-change-me-0123456789"
  );
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
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

export function verifyDownloadToken(token: string, nowSeconds?: number): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
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
