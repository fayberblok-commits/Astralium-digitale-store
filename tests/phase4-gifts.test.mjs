import { test, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;
process.env.PII_ENCRYPTION_KEY = "phase4-test-pii-key-0123456789abcdef";

const gifts = await import("../src/lib/gifts.ts");
const { decryptPii } = await import("../src/lib/pii.ts");
const { getFlag } = await import("../src/lib/flags.ts");

const ORDER = `ORD-GIFT-${Date.now()}`; // deliberately not claim-code-shaped
after(async () => {
  await gifts.deleteGiftsForOrder(ORDER);
});

test("validation: bad product, bad recipient, oversized message, bad date", () => {
  assert.equal(gifts.validateGiftInput({ productId: "nope", recipientEmail: "a@b.co" }).error, "PRODUCT_NOT_FOUND");
  assert.equal(gifts.validateGiftInput({ productId: "p01", recipientEmail: "not-an-email" }).error, "INVALID_RECIPIENT_EMAIL");
  assert.equal(gifts.validateGiftInput({ productId: "p01", recipientEmail: "a@b.co", message: "x".repeat(501) }).error, "MESSAGE_TOO_LONG");
  assert.equal(gifts.validateGiftInput({ productId: "p01", recipientEmail: "a@b.co", sendAt: "not-a-date" }).error, "INVALID_SEND_DATE");
  assert.equal(gifts.validateGiftInput({ productId: "p01", recipientEmail: "a@b.co" }).ok, true);
});

test("maskEmail hides the local part for buyer-facing confirmations", () => {
  assert.equal(gifts.maskEmail("jane.doe@example.com"), "ja***@example.com");
});

test("buyer confirmation contains NO download link and NO claim code", () => {
  const html = gifts.giftBuyerConfirmationHtml({
    orderId: ORDER,
    gifts: [{ title: "The AI Profit Blueprint", recipientMasked: "ja***@example.com", sendAt: null }],
  });
  assert.ok(!html.includes("/api/download"), "confirmation must not contain download URLs");
  assert.ok(!/AST-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(html), "confirmation must not contain a claim code");
  assert.ok(html.includes(ORDER));
  assert.ok(html.includes("ja***@example.com"));
});

test("planning: future sendAt is held (scheduled), past/null delivers now", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const mk = (id, sendAt) => ({
    id, orderId: ORDER, productId: "p01", buyerEmail: "buyer@example.com",
    recipientEmailHash: "h", recipientEmailCipher: "c", message: null,
    sendAt, status: "pending", createdAt: now.toISOString(), sentAt: null,
  });
  const plan = gifts.planGiftActions([
    mk("g1", null),
    mk("g2", "2026-10-29T00:00:00.000Z"), // past date → deliver now
    mk("g3", "2026-12-25T00:00:00.000Z"), // future → hold
    { ...mk("g4", null), status: "sent" }, // already sent → untouched
  ], now);
  assert.deepEqual(plan.deliverNow.map((g) => g.id), ["g1", "g2"]);
  assert.deepEqual(plan.schedule.map((g) => g.id), ["g3"]);

  const due = gifts.dueScheduledGifts([
    { ...mk("g5", "2026-10-30T00:00:00.000Z"), status: "scheduled" },
    { ...mk("g6", "2026-12-25T00:00:00.000Z"), status: "scheduled" },
    { ...mk("g7", null), status: "pending" },
  ], now);
  assert.deepEqual(due.map((g) => g.id), ["g5"]);
});

test("gift records: recipient stored encrypted only; decrypts for delivery", async () => {
  const created = await gifts.createGifts(ORDER, "buyer@example.com", [
    { productId: "p01", recipientEmail: "friend@example.com", message: "Happy birthday!" },
    { productId: "p03", recipientEmail: "later@example.com", sendAt: "2999-01-01T00:00:00.000Z" },
  ]);
  assert.equal(created.ok, true);
  const stored = await gifts.listGifts({ orderId: ORDER });
  assert.equal(stored.length, 2);
  for (const g of stored) {
    assert.ok(!JSON.stringify(g).includes("@example.com") || g.buyerEmail.includes("@example.com"));
    assert.ok(!g.recipientEmailCipher.includes("friend@example.com"));
  }
  const first = stored.find((g) => g.productId === "p01");
  assert.equal(decryptPii(first.recipientEmailCipher), "friend@example.com");
  assert.equal(first.status, "pending");
});

test("paid-order processing: immediate gift delivered, scheduled gift held", async () => {
  const summary = await gifts.processPaidOrderGifts(ORDER);
  assert.equal(summary.gifts, 2);
  assert.equal(summary.delivered, 1); // p01 delivered via orchestrator email (log-only Resend)
  assert.equal(summary.scheduled, 1); // p03 held for year 2999
  assert.equal(summary.confirmationSent, true);
  const stored = await gifts.listGifts({ orderId: ORDER });
  assert.equal(stored.find((g) => g.productId === "p01").status, "sent");
  assert.equal(stored.find((g) => g.productId === "p03").status, "scheduled");
  // Reprocessing (webhook replay) touches nothing twice.
  const replay = await gifts.processPaidOrderGifts(ORDER);
  assert.equal(replay.delivered, 0);
  assert.equal(replay.confirmationSent, false);
});

test("scheduled gift job: only due gifts are delivered", async () => {
  const summary = await gifts.runScheduledGiftJob(new Date());
  assert.equal(summary.due, 0); // the year-2999 gift is not due
  const future = await gifts.runScheduledGiftJob(new Date("2999-06-01T00:00:00.000Z"));
  assert.equal(future.due, 1);
  assert.equal(future.delivered, 1);
  const stored = await gifts.listGifts({ orderId: ORDER });
  assert.equal(stored.find((g) => g.productId === "p03").status, "sent");
});

test("gifts flag defaults OFF", async () => {
  assert.equal(await getFlag("gifts"), false);
});
