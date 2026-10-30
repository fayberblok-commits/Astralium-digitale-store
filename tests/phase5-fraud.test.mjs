import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = mkdtempSync(path.join(tmpdir(), "astralium-p5-fraud-"));
process.chdir(cwd);
delete process.env.DATABASE_URL;
process.env.PII_ENCRYPTION_KEY = "phase5-test-pii-key-0123456789abcdef";

const fraud = await import("../src/lib/fraud.ts");

const RUN = Date.now();
const clean = { disposableDomain: false, checkoutsLastHourByEmail: 1, checkoutsLastHourByIp: 1, failedLast24hByEmail: 0, amountUSD: 19 };

test("scoreRisk: a clean checkout scores 0 with no reasons", () => {
  assert.deepEqual(fraud.scoreRisk(clean), { score: 0, reasons: [] });
});

test("scoreRisk: each signal contributes its documented weight", () => {
  assert.equal(fraud.scoreRisk({ ...clean, disposableDomain: true }).score, 40);
  assert.equal(fraud.scoreRisk({ ...clean, checkoutsLastHourByEmail: 3 }).score, 20);
  assert.equal(fraud.scoreRisk({ ...clean, checkoutsLastHourByEmail: 5 }).score, 35);
  assert.equal(fraud.scoreRisk({ ...clean, checkoutsLastHourByIp: 5 }).score, 15);
  assert.equal(fraud.scoreRisk({ ...clean, checkoutsLastHourByIp: 10 }).score, 30);
  assert.equal(fraud.scoreRisk({ ...clean, amountUSD: 251 }).score, 15);
  assert.equal(fraud.scoreRisk({ ...clean, amountUSD: 751 }).score, 30);
  assert.equal(fraud.scoreRisk({ ...clean, failedLast24hByEmail: 2 }).score, 20);
  assert.equal(fraud.scoreRisk({ ...clean, failedLast24hByEmail: 4 }).score, 35);
  // Everything at max clamps to 100, reasons stay distinct codes.
  const max = fraud.scoreRisk({ disposableDomain: true, checkoutsLastHourByEmail: 9, checkoutsLastHourByIp: 20, failedLast24hByEmail: 9, amountUSD: 5000 });
  assert.equal(max.score, 100);
  assert.equal(new Set(max.reasons).size, max.reasons.length);
});

test("disposable domains: known throwaway providers detected, real ones not", () => {
  assert.equal(fraud.isDisposableEmail("x@mailinator.com"), true);
  assert.equal(fraud.isDisposableEmail("x@GuerrillaMail.com"), true);
  assert.equal(fraud.isDisposableEmail("x@gmail.com"), false);
  assert.equal(fraud.isDisposableEmail("x@company.example"), false);
});

test("blacklist: add → enforced → remove; stored hash-only", async () => {
  const email = `bad-${RUN}@example.com`;
  assert.equal(await fraud.isBlacklisted(email), false);
  const { record } = await fraud.addToBlacklist(email, "chargeback abuse");
  assert.equal(await fraud.isBlacklisted(email), true);
  const raw = readFileSync(path.join(cwd, ".data", "fraud-blacklist.json"), "utf8");
  assert.ok(!raw.includes(email), "raw email must never be stored");
  assert.ok(raw.includes(record.emailHash));
  // Assessment hard-blocks a blacklisted buyer before scoring.
  const blocked = await fraud.assessCheckout({ orderId: `AST-BL-${RUN}`, email, ip: "1.2.3.4", amountUSD: 10 });
  assert.deepEqual(blocked, { blocked: true });
  const removed = await fraud.removeFromBlacklist(record.id);
  assert.equal(removed.ok, true);
  assert.equal(await fraud.isBlacklisted(email), false);
});

test("assessment: ordinary buyer is not held; telemetry records hashes only", async () => {
  const email = `jane-${RUN}@example.com`;
  const res = await fraud.assessCheckout({ orderId: `AST-OK-${RUN}`, email, ip: "8.8.8.8", amountUSD: 29 });
  assert.deepEqual(res, { blocked: false, held: false, score: 0, reasons: [] });
  const raw = readFileSync(path.join(cwd, ".data", "fraud-events.json"), "utf8");
  assert.ok(!raw.includes(email) && !raw.includes("8.8.8.8"), "events store hashes only");
});

test("assessment: disposable email + amount anomaly crosses the threshold → HELD", async () => {
  const orderId = `AST-HELD-${RUN}`;
  const res = await fraud.assessCheckout({ orderId, email: `x-${RUN}@mailinator.com`, ip: "9.9.9.9", amountUSD: 900 });
  assert.equal(res.blocked, false);
  assert.equal(res.held, true);
  assert.equal(res.score, 70); // 40 disposable + 30 amount anomaly
  assert.deepEqual(res.reasons, ["DISPOSABLE_EMAIL", "AMOUNT_ANOMALY_HIGH"]);
  assert.equal(await fraud.isOrderHeld(orderId), true);
  const hold = await fraud.getHold(orderId);
  assert.equal(hold.status, "pending");
  // Buyer email recoverable for release only via the PII ciphertext.
  assert.equal(fraud.holdBuyerEmail(hold), `x-${RUN}@mailinator.com`);
  const raw = readFileSync(path.join(cwd, ".data", "fraud-holds.json"), "utf8");
  assert.ok(!raw.includes(`x-${RUN}@mailinator.com`), "hold stores hash + ciphertext, never plaintext");
});

test("release opens the gate; a resolved hold cannot be resolved twice", async () => {
  const orderId = `AST-REL-${RUN}`;
  await fraud.assessCheckout({ orderId, email: `y-${RUN}@yopmail.com`, ip: "7.7.7.7", amountUSD: 800 });
  const hold = await fraud.getHold(orderId);
  const resolved = await fraud.resolveHold(hold.id, "released");
  assert.equal(resolved.status, "released");
  assert.equal(await fraud.isOrderHeld(orderId), false);
  assert.equal(await fraud.resolveHold(hold.id, "rejected"), null);
});

test("velocity: repeated checkouts by one email raise the score until held", async () => {
  const email = `vel-${RUN}@example.com`;
  let last;
  for (let i = 1; i <= 5; i++) {
    last = await fraud.assessCheckout({ orderId: `AST-V${i}-${RUN}`, email, ip: "5.5.5.5", amountUSD: 800 });
  }
  // 5th checkout: email velocity high (+35) + IP velocity (+15) +
  // amount anomaly high (+30) = 80 ≥ 60 → held.
  assert.equal(last.held, true);
  assert.equal(last.score, 80);
  assert.ok(last.reasons.includes("EMAIL_VELOCITY_HIGH"));
  assert.ok(last.reasons.includes("IP_VELOCITY"));
});

test("failed attempts feed the scorer", async () => {
  const email = `fail-${RUN}@example.com`;
  await fraud.recordFailedAttempt({ email, ip: "6.6.6.6" });
  await fraud.recordFailedAttempt({ email, ip: "6.6.6.6" });
  const counts = await fraud.velocityCounts(email, "6.6.6.6");
  assert.equal(counts.failedByEmailDay, 2);
  const res = await fraud.assessCheckout({ orderId: `AST-F-${RUN}`, email, ip: "6.6.6.6", amountUSD: 900 });
  assert.equal(res.score, 50); // 20 repeated failures + 30 amount
  assert.ok(res.reasons.includes("REPEATED_FAILURES"));
});

test("threshold is owner-tunable and sanitised", async () => {
  assert.deepEqual(fraud.sanitizeFraudConfig({ threshold: 5 }), { threshold: 10 });
  assert.deepEqual(fraud.sanitizeFraudConfig({ threshold: 500 }), { threshold: 100 });
  assert.deepEqual(fraud.sanitizeFraudConfig({}), { threshold: 60 });
  await fraud.setFraudConfig({ threshold: 90 });
  const res = await fraud.assessCheckout({ orderId: `AST-T-${RUN}`, email: `z-${RUN}@mailinator.com`, ip: "4.4.4.4", amountUSD: 900 });
  assert.equal(res.score, 70);
  assert.equal(res.held, false); // same signals, higher owner threshold
});
