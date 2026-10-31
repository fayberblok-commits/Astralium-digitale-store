/**
 * S3 storage adapter — zero dependencies.
 *
 * Implements AWS Signature Version 4 by hand (node:crypto) for:
 *  - presigned PUT URLs  (browser uploads product files straight to S3)
 *  - presigned GET URLs  (short-lived download links — raw storage URLs are
 *                         never exposed; the app redirects to a 15-minute URL)
 *  - signed HEAD requests (existence checks on upload confirmation)
 *
 * Works with AWS S3 and S3-compatible endpoints (Cloudflare R2, MinIO,
 * Wasabi…) via S3_ENDPOINT, and with path-style addressing via
 * S3_FORCE_PATH_STYLE=1 (required by MinIO, optional for R2).
 *
 * Object keys are namespaced:
 *   products/<productId>/<filename>   — paid deliverables (private)
 *   previews/<productId>/<filename>   — free preview assets
 */
import { createHash, createHmac } from "node:crypto";

export interface StorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string; // e.g. https://<account>.r2.cloudflarestorage.com
  forcePathStyle?: boolean;
}

export function getStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig | null {
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region: env.S3_REGION || "us-east-1",
    accessKeyId,
    secretAccessKey,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: ["1", "true"].includes((env.S3_FORCE_PATH_STYLE || "").toLowerCase()),
  };
}

export function isStorageConfigured(): boolean {
  return getStorageConfig() !== null;
}

export function productFileKey(productId: string, filename: string): string {
  return `products/${productId}/${filename}`;
}

export function previewFileKey(productId: string, filename: string): string {
  return `previews/${productId}/${filename}`;
}

// ─── SigV4 primitives ────────────────────────────────────────────────────────

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** The AWS V4 signing-key chain: HMAC("AWS4"+secret, date) → region → service → "aws4_request". */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string, // YYYYMMDD
  region: string,
  service = "s3",
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

interface ResolvedTarget {
  host: string;
  path: string;
  protocol: string;
}

/** Resolve bucket/key to host+path for AWS virtual-host, endpoint virtual-host, or path style. */
export function resolveTarget(cfg: StorageConfig, key: string): ResolvedTarget {
  const encoded = `/${encodeKey(key)}`;
  if (cfg.endpoint) {
    const ep = new URL(cfg.endpoint);
    if (cfg.forcePathStyle) {
      return { host: ep.host, path: `/${cfg.bucket}${encoded}`, protocol: ep.protocol };
    }
    return { host: `${cfg.bucket}.${ep.host}`, path: encoded, protocol: ep.protocol };
  }
  if (cfg.forcePathStyle) {
    return { host: `s3.${cfg.region}.amazonaws.com`, path: `/${cfg.bucket}${encoded}`, protocol: "https:" };
  }
  return { host: `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`, path: encoded, protocol: "https:" };
}

// ─── Presigned URLs ──────────────────────────────────────────────────────────

export function buildPresignedUrl(
  cfg: StorageConfig,
  method: "GET" | "PUT",
  key: string,
  expiresSec: number,
  now: Date = new Date(),
): string {
  const { amzDate, dateStamp } = amzDates(now);
  const { host, path, protocol } = resolveTarget(cfg, key);
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = createHmac("sha256", deriveSigningKey(cfg.secretAccessKey, dateStamp, cfg.region))
    .update(stringToSign)
    .digest("hex");

  return `${protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function presignPut(key: string, _contentType?: string, expiresSec = 3600): string | null {
  const cfg = getStorageConfig();
  if (!cfg) return null;
  // Content-Type is intentionally NOT signed: the browser sets it on the PUT
  // and unsigned headers are ignored by S3 signature validation.
  void _contentType;
  return buildPresignedUrl(cfg, "PUT", key, expiresSec);
}

export function presignGet(key: string, expiresSec = 900): string | null {
  const cfg = getStorageConfig();
  if (!cfg) return null;
  return buildPresignedUrl(cfg, "GET", key, expiresSec);
}

// ─── Signed HEAD (existence check) ───────────────────────────────────────────

export function buildSignedHeaders(
  cfg: StorageConfig,
  method: string,
  key: string,
  now: Date = new Date(),
): { url: string; headers: Record<string, string> } {
  const { amzDate, dateStamp } = amzDates(now);
  const { host, path, protocol } = resolveTarget(cfg, key);
  const payloadHash = sha256Hex("");
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaderNames.join(";"), payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", deriveSigningKey(cfg.secretAccessKey, dateStamp, cfg.region))
    .update(stringToSign)
    .digest("hex");
  return {
    url: `${protocol}//${host}${path}`,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
  };
}

/**
 * Fetch an object's bytes server-side (signed GET). Used by PDF
 * watermarking (Phase 5): the object is pulled through the app so the
 * stamped copy — never the original — is what reaches the buyer.
 * Returns null when storage is unconfigured, the object is missing, or
 * the body exceeds `maxBytes` (caller falls back to the presigned path).
 */
export async function getObjectBytes(
  key: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  const cfg = getStorageConfig();
  if (!cfg) return null;
  const { url, headers } = buildSignedHeaders(cfg, "GET", key);
  try {
    const res = await fetchImpl(url, { method: "GET", headers });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Fetch only the first `n` bytes of an object (Range GET; the Range
 * header is not part of the SigV4 signed set here). Used by the §9
 * magic-byte verification at upload-confirm time — never pulls a whole
 * deliverable into memory just to sniff it.
 */
export async function getObjectHeadBytes(
  key: string,
  n: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  const cfg = getStorageConfig();
  if (!cfg) return null;
  const { url, headers } = buildSignedHeaders(cfg, "GET", key);
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { ...headers, Range: `bytes=0-${n - 1}` } });
    if (!res.ok && res.status !== 206) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.subarray(0, n);
  } catch {
    return null;
  }
}

/** Delete an object (signed DELETE). Used to destroy uploads whose bytes fail verification. */
export async function deleteObject(key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const cfg = getStorageConfig();
  if (!cfg) return false;
  const { url, headers } = buildSignedHeaders(cfg, "DELETE", key);
  try {
    const res = await fetchImpl(url, { method: "DELETE", headers });
    return res.status === 204 || res.status === 200 || res.status === 404;
  } catch {
    return false;
  }
}

export async function headObject(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ exists: boolean; contentLength?: number; contentType?: string }> {
  const cfg = getStorageConfig();
  if (!cfg) return { exists: false };
  const { url, headers } = buildSignedHeaders(cfg, "HEAD", key);
  try {
    const res = await fetchImpl(url, { method: "HEAD", headers });
    if (res.status === 200) {
      return {
        exists: true,
        contentLength: Number(res.headers.get("content-length") ?? 0) || undefined,
        contentType: res.headers.get("content-type") ?? undefined,
      };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
}
