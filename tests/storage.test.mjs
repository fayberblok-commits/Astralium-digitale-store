import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  buildPresignedUrl,
  buildSignedHeaders,
  deriveSigningKey,
  headObject,
  productFileKey,
  previewFileKey,
  resolveTarget,
} from "../src/services/storage.ts";

const CFG = {
  bucket: "astralium-files",
  region: "eu-west-1",
  accessKeyId: "AKIATESTEXAMPLE",
  secretAccessKey: "test-secret-key/EXAMPLE+0123456789",
};
const FIXED_NOW = new Date("2026-01-15T12:30:00.000Z");

test("key namespaces", () => {
  assert.equal(productFileKey("p01", "book.pdf"), "products/p01/book.pdf");
  assert.equal(previewFileKey("p01", "ch1.pdf"), "previews/p01/ch1.pdf");
});

test("deriveSigningKey: 32-byte, deterministic, date-sensitive", () => {
  const a = deriveSigningKey(CFG.secretAccessKey, "20260115", "eu-west-1");
  const b = deriveSigningKey(CFG.secretAccessKey, "20260115", "eu-west-1");
  const c = deriveSigningKey(CFG.secretAccessKey, "20260116", "eu-west-1");
  assert.equal(a.length, 32);
  assert.ok(a.equals(b));
  assert.ok(!a.equals(c));
  // Independent recomputation of the documented AWS chain.
  const h = (k, d) => createHmac("sha256", k).update(d).digest();
  const expected = h(h(h(h(`AWS4${CFG.secretAccessKey}`, "20260115"), "eu-west-1"), "s3"), "aws4_request");
  assert.ok(a.equals(expected));
});

test("presigned GET: structure + independently recomputed signature", () => {
  const url = new URL(buildPresignedUrl(CFG, "GET", "products/p01/book.pdf", 900, FIXED_NOW));
  assert.equal(url.host, "astralium-files.s3.eu-west-1.amazonaws.com");
  assert.equal(url.pathname, "/products/p01/book.pdf");
  const q = url.searchParams;
  assert.equal(q.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(q.get("X-Amz-Credential"), "AKIATESTEXAMPLE/20260115/eu-west-1/s3/aws4_request");
  assert.equal(q.get("X-Amz-Date"), "20260115T123000Z");
  assert.equal(q.get("X-Amz-Expires"), "900");
  assert.equal(q.get("X-Amz-SignedHeaders"), "host");
  const sig = q.get("X-Amz-Signature");
  assert.match(sig, /^[0-9a-f]{64}$/);

  // Rebuild the canonical request from the URL and re-sign from primitives.
  const canonicalQuery = [...q.entries()]
    .filter(([k]) => k !== "X-Amz-Signature")
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonical = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const scope = "20260115/eu-west-1/s3/aws4_request";
  const sts = ["AWS4-HMAC-SHA256", "20260115T123000Z", scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const expectedSig = createHmac("sha256", deriveSigningKey(CFG.secretAccessKey, "20260115", "eu-west-1")).update(sts).digest("hex");
  assert.equal(sig, expectedSig);
});

test("presigned PUT differs from GET and is expiry-bound", () => {
  const get = buildPresignedUrl(CFG, "GET", "products/p01/a.pdf", 900, FIXED_NOW);
  const put = buildPresignedUrl(CFG, "PUT", "products/p01/a.pdf", 3600, FIXED_NOW);
  assert.notEqual(get, put);
  assert.ok(put.includes("X-Amz-Expires=3600"));
});

test("resolveTarget: path-style endpoint (MinIO) and virtual-host endpoint (R2)", () => {
  const minio = resolveTarget({ ...CFG, endpoint: "http://localhost:9000", forcePathStyle: true }, "products/p01/a.pdf");
  assert.equal(minio.host, "localhost:9000");
  assert.equal(minio.path, "/astralium-files/products/p01/a.pdf");
  const r2 = resolveTarget({ ...CFG, endpoint: "https://acct.r2.cloudflarestorage.com" }, "products/p01/a.pdf");
  assert.equal(r2.host, "astralium-files.acct.r2.cloudflarestorage.com");
  assert.equal(r2.path, "/products/p01/a.pdf");
});

test("buildSignedHeaders: Authorization shape", () => {
  const { url, headers } = buildSignedHeaders(CFG, "HEAD", "products/p01/a.pdf", FIXED_NOW);
  assert.equal(url, "https://astralium-files.s3.eu-west-1.amazonaws.com/products/p01/a.pdf");
  assert.match(headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIATESTEXAMPLE\/20260115\/eu-west-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test("headObject with mocked fetch: 200 → exists, 404 → missing, throw → missing", async () => {
  process.env.S3_BUCKET = CFG.bucket;
  process.env.S3_REGION = CFG.region;
  process.env.S3_ACCESS_KEY_ID = CFG.accessKeyId;
  process.env.S3_SECRET_ACCESS_KEY = CFG.secretAccessKey;
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_FORCE_PATH_STYLE;
  try {
    const okFetch = async () => ({
      status: 200,
      headers: { get: (k) => ({ "content-length": "123", "content-type": "application/pdf" })[k] ?? null },
    });
    const res = await headObject("products/p01/a.pdf", okFetch);
    assert.equal(res.exists, true);
    assert.equal(res.contentLength, 123);

    const notFound = async () => ({ status: 404, headers: { get: () => null } });
    assert.equal((await headObject("products/p01/a.pdf", notFound)).exists, false);

    const boom = async () => { throw new Error("network down"); };
    assert.equal((await headObject("products/p01/a.pdf", boom)).exists, false);
  } finally {
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  }
});
