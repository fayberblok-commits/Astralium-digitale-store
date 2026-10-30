import { test, after } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;
process.env.PII_ENCRYPTION_KEY = "phase4-test-pii-key-0123456789abcdef";

const subs = await import("../src/lib/subscriptions.ts");
const { getFlag } = await import("../src/lib/flags.ts");

const SUB_ID = `sub_phase4_${Date.now()}`;
after(async () => {
  await subs.deleteSubscriptionForTest(SUB_ID);
});

test("checkout params: subscription mode, recurring price from server plan config", () => {
  const form = subs.buildSubscriptionCheckoutParams({
    productId: "p07", plan: { interval: "month", priceUSD: 12.5 },
    productTitle: "PromptForge Studio", email: "sub@example.com",
    base: "https://store.example", locale: "en",
  });
  assert.equal(form.get("mode"), "subscription");
  assert.equal(form.get("line_items[0][price_data][recurring][interval]"), "month");
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "1250"); // plan price, not any client value
  assert.equal(form.get("metadata[kind]"), "subscription");
  assert.equal(form.get("metadata[product_id]"), "p07");
  assert.equal(form.get("customer_email"), "sub@example.com");
});

test("portal params: customer + return url only", () => {
  const form = subs.buildPortalParams({ customerId: "cus_123", base: "https://store.example", locale: "fr" });
  assert.equal(form.get("customer"), "cus_123");
  assert.equal(form.get("return_url"), "https://store.example/fr/account");
});

test("plan sanitize: unknown products and non-positive prices dropped", () => {
  const clean = subs.sanitizePlanConfig({
    p07: { interval: "year", priceUSD: 99 },
    p01: { interval: "weekly", priceUSD: -3 },
    nope: { interval: "month", priceUSD: 5 },
  });
  assert.deepEqual(Object.keys(clean), ["p07"]);
  assert.equal(clean.p07.interval, "year");
});

function checkoutEvent() {
  return {
    type: "checkout_completed", stripeSubscriptionId: SUB_ID,
    stripeCustomerId: "cus_phase4", email: "sub@example.com", productId: "p07",
  };
}

test("reducer: checkout → invoice.paid grants once per cycle (replay-safe)", () => {
  const created = subs.applySubscriptionEvent(null, checkoutEvent());
  assert.equal(created.record.status, "incomplete");
  assert.deepEqual(created.actions, ["none"]);

  const paid = subs.applySubscriptionEvent(created.record, {
    type: "invoice_paid", stripeSubscriptionId: SUB_ID, periodEndISO: "2026-11-30T00:00:00.000Z",
  });
  assert.equal(paid.record.status, "active");
  assert.ok(paid.actions.includes("grant"));

  // Webhook replay of the SAME invoice.paid: still active, but NO second grant.
  const replay = subs.applySubscriptionEvent(paid.record, {
    type: "invoice_paid", stripeSubscriptionId: SUB_ID, periodEndISO: "2026-11-30T00:00:00.000Z",
  });
  assert.equal(replay.record.status, "active");
  assert.ok(!replay.actions.includes("grant"));

  // Next cycle (new period end): grants again.
  const nextCycle = subs.applySubscriptionEvent(replay.record, {
    type: "invoice_paid", stripeSubscriptionId: SUB_ID, periodEndISO: "2026-12-31T00:00:00.000Z",
  });
  assert.ok(nextCycle.actions.includes("grant"));
});

test("reducer: failed payment → past_due; the dunning clock never resets", () => {
  const created = subs.applySubscriptionEvent(null, checkoutEvent());
  const failed = subs.applySubscriptionEvent(created.record, {
    type: "invoice_payment_failed", stripeSubscriptionId: SUB_ID, atISO: "2026-11-01T10:00:00.000Z",
  });
  assert.equal(failed.record.status, "past_due");
  assert.equal(failed.record.pastDueSince, "2026-11-01T10:00:00.000Z");
  const failedAgain = subs.applySubscriptionEvent(failed.record, {
    type: "invoice_payment_failed", stripeSubscriptionId: SUB_ID, atISO: "2026-11-05T10:00:00.000Z",
  });
  assert.equal(failedAgain.record.pastDueSince, "2026-11-01T10:00:00.000Z"); // original failure time kept
  // Recovery: a paid invoice clears past_due and resets the dunning step.
  const recovered = subs.applySubscriptionEvent(failedAgain.record, {
    type: "invoice_paid", stripeSubscriptionId: SUB_ID, periodEndISO: "2026-12-01T00:00:00.000Z",
  });
  assert.equal(recovered.record.status, "active");
  assert.equal(recovered.record.pastDueSince, null);
  assert.equal(recovered.record.dunningStep, 0);
  // Cancellation is terminal for dunning.
  const canceled = subs.applySubscriptionEvent(recovered.record, { type: "subscription_deleted", stripeSubscriptionId: SUB_ID });
  assert.equal(canceled.record.status, "canceled");
  const lateFail = subs.applySubscriptionEvent(canceled.record, {
    type: "invoice_payment_failed", stripeSubscriptionId: SUB_ID, atISO: "2026-12-05T00:00:00.000Z",
  });
  assert.equal(lateFail.record.status, "canceled");
});

test("dunning schedule: reminders due at offsets 0/3/7 days, step by step", () => {
  const base = {
    id: "x", emailHash: "h", emailCipher: "", productId: "p07",
    stripeCustomerId: "cus", stripeSubscriptionId: SUB_ID, status: "past_due",
    currentPeriodEnd: null, lastGrantedPeriodEnd: null,
    pastDueSince: "2026-11-01T00:00:00.000Z", dunningStep: 0, lastReminderAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  assert.equal(subs.DUNNING_OFFSETS_DAYS.join(","), "0,3,7");
  assert.equal(subs.dueDunningReminders([base], new Date("2026-11-01T00:00:01.000Z")).length, 1); // step 0 due immediately
  const step1 = { ...base, dunningStep: 1 };
  assert.equal(subs.dueDunningReminders([step1], new Date("2026-11-03T23:59:59.000Z")).length, 0); // day 3 not reached
  assert.equal(subs.dueDunningReminders([step1], new Date("2026-11-04T00:00:00.000Z")).length, 1);
  const step3 = { ...base, dunningStep: 3 };
  assert.equal(subs.dueDunningReminders([step3], new Date("2027-01-01T00:00:00.000Z")).length, 0); // sequence exhausted
  const active = { ...base, status: "active" };
  assert.equal(subs.dueDunningReminders([active], new Date("2027-01-01T00:00:00.000Z")).length, 0);
});

test("end-to-end (file store): events persist; dunning job uses the injected mock sender", async () => {
  const created = await subs.processSubscriptionEvent(checkoutEvent());
  assert.equal(created.status, "incomplete");
  const paid = await subs.processSubscriptionEvent({
    type: "invoice_paid", stripeSubscriptionId: SUB_ID, periodEndISO: "2026-11-30T00:00:00.000Z",
  });
  assert.equal(paid.status, "active");
  assert.equal(paid.granted, true); // grant delivered via orchestrator email (log-only Resend)
  const failed = await subs.processSubscriptionEvent({
    type: "invoice_payment_failed", stripeSubscriptionId: SUB_ID, atISO: "2026-12-01T00:00:00.000Z",
  });
  assert.equal(failed.status, "past_due");

  const sentTo = [];
  const mockSender = async (msg) => { sentTo.push(msg); return { delivered: false, provider: "mock" }; };
  const run1 = await subs.runDunningJob(new Date("2026-12-01T01:00:00.000Z"), mockSender);
  assert.equal(run1.sent, 1);
  assert.equal(sentTo[0].to, "sub@example.com");
  assert.equal(sentTo[0].kind, "dunning");
  const tooEarly = await subs.runDunningJob(new Date("2026-12-02T00:00:00.000Z"), mockSender);
  assert.equal(tooEarly.sent, 0); // step 1 not due until day 3
  const run2 = await subs.runDunningJob(new Date("2026-12-04T00:00:00.000Z"), mockSender);
  assert.equal(run2.sent, 1);
  const run3 = await subs.runDunningJob(new Date("2026-12-08T00:00:00.000Z"), mockSender);
  assert.equal(run3.sent, 1);
  assert.ok(sentTo[2].subject.startsWith("Final notice"));
  const exhausted = await subs.runDunningJob(new Date("2027-01-01T00:00:00.000Z"), mockSender);
  assert.equal(exhausted.sent, 0);
});

test("subscriptions flag defaults OFF (money feature)", async () => {
  assert.equal(await getFlag("subscriptions"), false);
});
