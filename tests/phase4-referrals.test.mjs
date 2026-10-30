import { test, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const ref = await import("../src/lib/referrals.ts");
const { getFlag } = await import("../src/lib/flags.ts");

const OWNER = `phase4-ref-owner-${Date.now()}@example.com`;
const BUYER = `phase4-ref-buyer-${Date.now()}@example.com`;
after(async () => {
  await ref.deleteReferralCodeForEmail(OWNER);
  await ref.deleteReferralCodeForEmail(BUYER);
});

test("cookie parsing + first-touch attribution (existing cookie always wins)", () => {
  assert.equal(ref.parseRefCookie("a=1; astralium-ref=ASTR-AB12-CD34; b=2"), "ASTR-AB12-CD34");
  assert.equal(ref.parseRefCookie("a=1; b=2"), null);
  assert.equal(ref.parseRefCookie(null), null);
  // First touch: a stored cookie is never overwritten by a later code.
  assert.equal(ref.firstTouchCode("ASTR-OLD1-AAAA", "ASTR-NEW2-BBBB"), "ASTR-OLD1-AAAA");
  assert.equal(ref.firstTouchCode(null, "astr-new2-bbbb"), "ASTR-NEW2-BBBB");
  assert.equal(ref.firstTouchCode(null, null), null);
  assert.equal(ref.REF_TTL_DAYS, 30);
});

test("commission math: percent of the order total, clamped, 2dp", () => {
  assert.equal(ref.commissionFor(100, 10), 10);
  assert.equal(ref.commissionFor(19.99, 10), 2);
  assert.equal(ref.commissionFor(100, 500), 50); // percent clamped to 50
  assert.equal(ref.commissionFor(0, 10), 0);
});

test("codes: one stable code per customer; link format carries the code", async () => {
  const a = await ref.getOrCreateReferralCode(OWNER);
  const b = await ref.getOrCreateReferralCode(OWNER);
  assert.equal(a.code, b.code);
  assert.match(a.code, /^ASTR-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(ref.referralLink("https://store.example/", a.code, "ar"), `https://store.example/ar?ref=${a.code}`);
});

test("attribution: recorded once per order — double attribution impossible", async () => {
  const { code } = await ref.getOrCreateReferralCode(OWNER);
  const first = await ref.recordAttribution({
    code, orderId: "AST-R1", buyerEmail: BUYER, orderTotalUSD: 200, commissionPercent: 10,
  });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.attribution.status, "pending");
  assert.equal(first.attribution.commissionUSD, 20);

  const second = await ref.recordAttribution({
    code, orderId: "AST-R1", buyerEmail: BUYER, orderTotalUSD: 999, commissionPercent: 50,
  });
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true); // original record returned untouched
  assert.equal(second.attribution.commissionUSD, 20);
  assert.equal(second.attribution.orderTotalUSD, 200);

  const all = await ref.listCommissions();
  assert.equal(all.filter((c) => c.orderId === "AST-R1").length, 1);
});

test("attribution: self-referral and unknown codes are rejected", async () => {
  const { code } = await ref.getOrCreateReferralCode(OWNER);
  const self = await ref.recordAttribution({
    code, orderId: "AST-R2", buyerEmail: OWNER, orderTotalUSD: 100, commissionPercent: 10,
  });
  assert.deepEqual(self, { ok: false, error: "SELF_REFERRAL" });
  const unknown = await ref.recordAttribution({
    code: "ASTR-ZZZZ-ZZZZ", orderId: "AST-R3", buyerEmail: BUYER, orderTotalUSD: 100, commissionPercent: 10,
  });
  assert.deepEqual(unknown, { ok: false, error: "UNKNOWN_CODE" });
});

test("attribution flips to earned exactly once (webhook replay-safe)", async () => {
  assert.equal(await ref.markAttributionEarned("AST-R1"), true);
  assert.equal(await ref.markAttributionEarned("AST-R1"), false); // already earned
  const stats = await ref.referralStats(OWNER);
  assert.equal(stats.orders, 1);
  assert.equal(stats.earnedUSD, 20);
  assert.equal(stats.pendingUSD, 0);
});

test("referrals flag defaults OFF (money feature)", async () => {
  assert.equal(await getFlag("referrals"), false);
});
