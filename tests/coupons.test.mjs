import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCoupon, priceCart } from "../src/lib/coupons.ts";

test("percent coupon math", () => {
  const r = applyCoupon("WELCOME10", 100, { isFirstOrder: true });
  assert.equal(r.ok, true);
  assert.equal(r.discountUSD, 10);
});

test("first-order-only coupon rejected for returning customers", () => {
  const r = applyCoupon("WELCOME10", 100, { isFirstOrder: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "first-order-only");
});

test("minimum subtotal enforced", () => {
  const low = applyCoupon("STUDENT20", 20, { isFirstOrder: false });
  assert.equal(low.ok, false);
  assert.equal(low.reason, "below-minimum");
  const ok = applyCoupon("STUDENT20", 50, { isFirstOrder: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.discountUSD, 10);
});

test("country-restricted coupon", () => {
  const no = applyCoupon("MENA15", 100, { isFirstOrder: false, country: "US" });
  assert.equal(no.ok, false);
  assert.equal(no.reason, "country-restricted");
  const yes = applyCoupon("MENA15", 100, { isFirstOrder: false, country: "MA" });
  assert.equal(yes.ok, true);
  assert.equal(yes.discountUSD, 15);
});

test("expired and paused coupons rejected", () => {
  assert.equal(applyCoupon("EXPIRED50", 100, { isFirstOrder: true }).ok, false);
  const paused = applyCoupon("PAUSED25", 100, { isFirstOrder: true });
  assert.equal(paused.ok, false);
  assert.equal(paused.reason, "inactive");
});

test("usage limit enforced", () => {
  const r = applyCoupon("FLASH5", 50, { isFirstOrder: true, usageCount: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "usage-limit-reached");
});

test("discount never exceeds subtotal and codes are case-insensitive", () => {
  const r = applyCoupon("flash5", 3, { isFirstOrder: true, usageCount: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.discountUSD, 3);
  const totals = priceCart(30, 999);
  assert.equal(totals.total, 0);
});
