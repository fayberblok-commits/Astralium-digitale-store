import { test, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const loyalty = await import("../src/lib/loyalty.ts");
const { getFlag } = await import("../src/lib/flags.ts");
const CFG = loyalty.DEFAULT_LOYALTY_CONFIG;

const EMAIL = `phase4-loyalty-${Date.now()}@example.com`;
after(async () => {
  await loyalty.deleteLoyaltyAccount(EMAIL);
});

test("tiers: thresholds and multipliers from lifetime earnings", () => {
  assert.equal(loyalty.tierFor(CFG, 0).name, "Bronze");
  assert.equal(loyalty.tierFor(CFG, 499).name, "Bronze");
  assert.equal(loyalty.tierFor(CFG, 500).name, "Silver");
  assert.equal(loyalty.tierFor(CFG, 2000).name, "Gold");
  assert.equal(loyalty.tierFor(CFG, 99999).multiplier, 1.5);
});

test("earn math: floor(total × rate × tier multiplier), tier from pre-order lifetime", () => {
  assert.equal(loyalty.earnPointsFor(CFG, 100, 0), 100); // Bronze ×1
  assert.equal(loyalty.earnPointsFor(CFG, 100, 500), 125); // Silver ×1.25
  assert.equal(loyalty.earnPointsFor(CFG, 100, 2000), 150); // Gold ×1.5
  assert.equal(loyalty.earnPointsFor(CFG, 19.99, 0), 19); // floored
  assert.equal(loyalty.earnPointsFor(CFG, 0, 0), 0);
});

test("redemption caps: balance cap AND max-%-of-total cap, server-side", () => {
  // Balance cap: 50 points available, 1000 requested → 50.
  assert.deepEqual(loyalty.redemptionFor(CFG, 50, 1000, 1000), { points: 50, valueUSD: 0.5 });
  // Percent cap: $10 order, 30% max → $3.00 → 300 points at $0.01, even with a huge balance.
  assert.deepEqual(loyalty.redemptionFor(CFG, 100000, 100000, 10), { points: 300, valueUSD: 3 });
  // Under both caps → the request stands.
  assert.deepEqual(loyalty.redemptionFor(CFG, 100000, 100, 1000), { points: 100, valueUSD: 1 });
  // Zero cases.
  assert.deepEqual(loyalty.redemptionFor(CFG, 0, 100, 100), { points: 0, valueUSD: 0 });
  assert.deepEqual(loyalty.redemptionFor(CFG, 100, 0, 100), { points: 0, valueUSD: 0 });
});

test("ledger: earn is idempotent per order; balance + lifetime tracked", async () => {
  const first = await loyalty.earnForOrder(EMAIL, "AST-L1", 100);
  assert.deepEqual(first, { points: 100, applied: true });
  const replay = await loyalty.earnForOrder(EMAIL, "AST-L1", 100);
  assert.deepEqual(replay, { points: 100, applied: false }); // same points reported, nothing re-applied
  const balance = await loyalty.getLoyaltyBalance(EMAIL);
  assert.equal(balance.balance, 100);
  assert.equal(balance.lifetimeEarned, 100);
  assert.equal(balance.tier.name, "Bronze");
  const second = await loyalty.earnForOrder(EMAIL, "AST-L2", 450);
  assert.equal(second.points, 450);
  const after2 = await loyalty.getLoyaltyBalance(EMAIL);
  assert.equal(after2.balance, 550);
  assert.equal(after2.tier.name, "Silver"); // lifetime 550 crosses the 500 threshold
});

test("ledger: spend applies caps and is idempotent per order", async () => {
  // Balance is 550 points. $10 order → 30% cap = $3 = 300 points max.
  const spend = await loyalty.spendForOrder(EMAIL, "AST-L3", 100000, 10);
  assert.deepEqual(spend, { points: 300, valueUSD: 3, applied: true });
  const replay = await loyalty.spendForOrder(EMAIL, "AST-L3", 100000, 10);
  assert.equal(replay.applied, false);
  assert.equal(replay.points, 300);
  const balance = await loyalty.getLoyaltyBalance(EMAIL);
  assert.equal(balance.balance, 250); // 550 − 300, exactly once
  const entries = await loyalty.listLoyaltyEntries(EMAIL);
  assert.equal(entries.filter((e) => e.idempotencyKey === "spend:AST-L3").length, 1);
  assert.equal(entries.filter((e) => e.idempotencyKey === "earn:AST-L1").length, 1);
});

test("ledger: preview does not write; commit writes exactly the previewed points", async () => {
  const before = await loyalty.getLoyaltyBalance(EMAIL);
  const preview = await loyalty.previewRedemption(EMAIL, 100, 1000);
  assert.equal(preview.points, 100);
  const mid = await loyalty.getLoyaltyBalance(EMAIL);
  assert.equal(mid.balance, before.balance); // unchanged by preview
  const commit = await loyalty.commitSpendForOrder(EMAIL, "AST-L4", preview.points);
  assert.equal(commit.applied, true);
  const afterBal = await loyalty.getLoyaltyBalance(EMAIL);
  assert.equal(afterBal.balance, before.balance - 100);
});

test("expiry: old earn entries expire once, never below zero", async () => {
  const email2 = `phase4-loyalty-exp-${Date.now()}@example.com`;
  try {
    await loyalty.earnForOrder(email2, "AST-EXP1", 40);
    const future = new Date(Date.now() + (CFG.expiryDays + 30) * 24 * 3600 * 1000);
    const firstRun = await loyalty.expireOldEntries(future);
    assert.ok(firstRun >= 1);
    const balance = await loyalty.getLoyaltyBalance(email2);
    assert.equal(balance.balance, 0);
    const secondRun = await loyalty.expireOldEntries(future);
    assert.equal(secondRun, 0); // idempotent — the expire entry already exists
  } finally {
    await loyalty.deleteLoyaltyAccount(email2);
  }
});

test("loyalty flag defaults OFF (money feature)", async () => {
  assert.equal(await getFlag("loyalty"), false);
});
