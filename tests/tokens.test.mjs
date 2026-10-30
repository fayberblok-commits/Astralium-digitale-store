import { test } from "node:test";
import assert from "node:assert/strict";
import { createDownloadToken, verifyDownloadToken } from "../src/lib/tokens.ts";

test("sign → verify round trip", () => {
  const token = createDownloadToken("p01", "AST-TEST1", { ttlSeconds: 3600, maxDownloads: 3 });
  const r = verifyDownloadToken(token);
  assert.equal(r.ok, true);
  assert.equal(r.payload.pid, "p01");
  assert.equal(r.payload.oid, "AST-TEST1");
  assert.equal(r.payload.max, 3);
});

test("expired token rejected", () => {
  const token = createDownloadToken("p01", "AST-TEST2", { ttlSeconds: -10 });
  const r = verifyDownloadToken(token);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
});

test("tampered token rejected as bad signature", () => {
  const token = createDownloadToken("p01", "AST-TEST3");
  const [body, sig] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ pid: "p12", oid: "AST-TEST3", exp: 9999999999, max: 99, n: "x" })).toString("base64url");
  assert.equal(verifyDownloadToken(`${forgedBody}.${sig}`).ok, false);
  assert.equal(verifyDownloadToken(`${body}.invalidsig`).reason, "bad-signature");
});

test("malformed tokens rejected", () => {
  assert.equal(verifyDownloadToken("not-a-token").reason, "malformed");
  assert.equal(verifyDownloadToken("").reason, "malformed");
});

test("explicit clock: expiry boundary", () => {
  const token = createDownloadToken("p02", "AST-TEST4", { ttlSeconds: 100 });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(verifyDownloadToken(token, now + 50).ok, true);
  assert.equal(verifyDownloadToken(token, now + 500).ok, false);
});
