import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL; // in-memory claim store

const {
  issueClaimCode, redeemClaimCode, extractClaimCode, normalizeClaimCode,
  createRefToken, verifyRefToken, __resetMemoryClaims,
} = await import("../src/lib/claim-codes.ts");

test("issue → redeem round trip; code format is AST-XXXX-XXXX", async () => {
  __resetMemoryClaims();
  const { code, expiresAt } = await issueClaimCode({ orderId: "AST-ORD1", productIds: ["p01", "p02"] });
  assert.match(code, /^AST-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok(expiresAt.getTime() > Date.now());
  const r = await redeemClaimCode(code);
  assert.equal(r.ok, true);
  assert.equal(r.orderId, "AST-ORD1");
  assert.deepEqual(r.productIds, ["p01", "p02"]);
});

test("single-use: second redeem of the same code is rejected as used", async () => {
  const { code } = await issueClaimCode({ orderId: "AST-ORD2", productIds: ["p03"] });
  assert.equal((await redeemClaimCode(code)).ok, true);
  const again = await redeemClaimCode(code);
  assert.equal(again.ok, false);
  assert.equal(again.reason, "used");
});

test("expired code is rejected as expired", async () => {
  const { code } = await issueClaimCode({ orderId: "AST-ORD3", productIds: ["p01"], ttlSeconds: -10 });
  const r = await redeemClaimCode(code);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
});

test("unknown / malformed codes are not-found", async () => {
  assert.equal((await redeemClaimCode("AST-ZZZZ-ZZZZ")).reason, "not-found");
  assert.equal((await redeemClaimCode("hello")).reason, "not-found");
  assert.equal((await redeemClaimCode("")).reason, "not-found");
});

test("extractClaimCode finds codes inside free message text", () => {
  assert.equal(extractClaimCode("Hi! My delivery code is AST-AB3K-9ZQX thanks"), "ASTAB3K9ZQX");
  assert.equal(extractClaimCode("ast ab3k 9zqx"), "ASTAB3K9ZQX");
  assert.equal(extractClaimCode("no code in this message"), null);
  assert.equal(normalizeClaimCode(" ast-ab3k-9zqx "), "ASTAB3K9ZQX");
});

test("ref tokens: sign → verify round trip with channel scope", () => {
  const token = createRefToken({ oid: "AST-ORD9", pids: ["p01"], ch: "messenger" });
  const r = verifyRefToken(token);
  assert.equal(r.ok, true);
  assert.equal(r.payload.oid, "AST-ORD9");
  assert.equal(r.payload.ch, "messenger");
  assert.deepEqual(r.payload.pids, ["p01"]);
});

test("ref tokens: tampered payload rejected; expired rejected", () => {
  const token = createRefToken({ oid: "AST-ORD9", pids: ["p01"], ch: "instagram" });
  const [, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ oid: "AST-OTHER", pids: ["p12"], ch: "instagram", exp: 9999999999 })).toString("base64url");
  assert.equal(verifyRefToken(`${forged}.${sig}`).reason, "bad-signature");
  const stale = createRefToken({ oid: "AST-ORD9", pids: ["p01"], ch: "instagram" }, -60);
  assert.equal(verifyRefToken(stale).reason, "expired");
  assert.equal(verifyRefToken("junk").reason, "malformed");
});
