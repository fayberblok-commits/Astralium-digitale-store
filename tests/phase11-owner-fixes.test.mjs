import { test } from "node:test";
import assert from "node:assert/strict";

// Owner fixes (2026-11): optional checkout email, express buy without
// the cart, and the PayPal SDK order pipeline. File data layer.
delete process.env.DATABASE_URL;

const { normalizeCheckoutEmail } = await import("../src/lib/checkout-rules.ts");
const {
  EXPRESS_QUERY_PARAM, isExpressId, parseExpressId, expressCheckoutHref,
  checkoutItemsFor, shouldClearCart,
} = await import("../src/lib/express.ts");
const { buildPaypalOrderBody } = await import("../src/lib/paypal.ts");
const orders = await import("../src/lib/orders.ts");

/* ── (b) checkout email is OPTIONAL ─────────────────────────────── */

test("checkout email: absent/blank email is accepted and normalised to empty", () => {
  for (const raw of [undefined, null, "", "   ", " \t "]) {
    const r = normalizeCheckoutEmail(raw);
    assert.equal(r.ok, true, JSON.stringify(raw));
    assert.equal(r.email, "");
    assert.equal(r.provided, false);
  }
});

test("checkout email: a provided email must be well-formed", () => {
  const good = normalizeCheckoutEmail("  Buyer@Example.com ");
  assert.equal(good.ok, true);
  assert.equal(good.email, "Buyer@Example.com"); // trimmed, otherwise untouched
  assert.equal(good.provided, true);
  for (const raw of ["notanemail", "a@b", "a b@c.com", "@x.com", "a@.com", "a@@b.com"]) {
    const r = normalizeCheckoutEmail(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(r.error, "INVALID_EMAIL");
  }
});

/* ── (c) express checkout never touches the cart ────────────────── */

test("express: href carries the single-item intent", () => {
  assert.equal(EXPRESS_QUERY_PARAM, "express");
  assert.equal(expressCheckoutHref("en", "prod-1"), "/en/checkout?express=prod-1");
  assert.equal(expressCheckoutHref("ar", "bundle x"), "/ar/checkout?express=bundle%20x");
});

test("express: param parsing accepts catalog ids and rejects junk", () => {
  assert.equal(parseExpressId("prod-1"), "prod-1");
  assert.equal(parseExpressId(["prod-2", "prod-3"]), "prod-2");
  assert.equal(parseExpressId(undefined), null);
  assert.equal(parseExpressId(""), null);
  assert.equal(parseExpressId("../etc/passwd"), null);
  assert.equal(parseExpressId("a b"), null);
  assert.equal(parseExpressId("x".repeat(65)), null);
  assert.equal(isExpressId("ok_id-9"), true);
  assert.equal(isExpressId(42), false);
});

test("express: checkout items are the express item ALONE; the cart is not read into it", () => {
  const cart = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const express = { id: "only-this-one" };
  const items = checkoutItemsFor(express, cart);
  assert.deepEqual(items, [express]);
  assert.equal(items.length, 1);
  // No express intent → the cart itself, by reference (unchanged flow).
  assert.equal(checkoutItemsFor(null, cart), cart);
  assert.equal(checkoutItemsFor(undefined, cart), cart);
});

test("express: completing an express purchase must NOT clear the cart", () => {
  assert.equal(shouldClearCart({ id: "x" }), false);
  assert.equal(shouldClearCart(null), true);
  assert.equal(shouldClearCart(undefined), true);
});

/* ── (a) SDK order creation shape ───────────────────────────────── */

test("paypal order body: CAPTURE intent, USD amount, ids and return urls", () => {
  const body = buildPaypalOrderBody({
    orderId: "AST-TEST1",
    productIds: ["p1", "p2"],
    totalUSD: 49,
    email: "buyer@example.com",
    returnUrl: "https://store.example/en/success?order=AST-TEST1",
    cancelUrl: "https://store.example/en/checkout",
  });
  assert.equal(body.intent, "CAPTURE");
  assert.equal(body.purchase_units.length, 1);
  const unit = body.purchase_units[0];
  assert.equal(unit.reference_id, "AST-TEST1");
  assert.equal(unit.custom_id, "p1,p2");
  assert.deepEqual(unit.amount, { currency_code: "USD", value: "49.00" });
  assert.deepEqual(body.payer, { email_address: "buyer@example.com" });
  assert.equal(body.application_context.return_url, "https://store.example/en/success?order=AST-TEST1");
  assert.equal(body.application_context.cancel_url, "https://store.example/en/checkout");
  assert.equal(body.application_context.user_action, "PAY_NOW");
});

test("paypal order body: no payer block at all when the buyer skipped email", () => {
  for (const email of [undefined, null, ""]) {
    const body = buildPaypalOrderBody({
      orderId: "AST-TEST2", productIds: ["p1"], totalUSD: 19.5, email,
      returnUrl: "https://store.example/en/success?order=AST-TEST2",
      cancelUrl: "https://store.example/en/checkout",
    });
    assert.equal("payer" in body, false, String(email));
    assert.equal(body.purchase_units[0].amount.value, "19.50"); // cents always two decimals
  }
});

/* ── (b) payer email from capture fills an empty order email only ── */

test("orders: setOrderEmailIfEmpty fills a blank email and never overwrites", async () => {
  const ref = `TEST-PP-${Date.now().toString(36)}`;
  await orders.createPendingOrder({
    orderId: `AST-${ref}`, email: "", provider: "paypal", providerRef: ref,
    items: [{ productId: "p1", priceUSD: 10 }], totalUSD: 10, currency: "USD", locale: "en",
  });
  const filled = await orders.setOrderEmailIfEmpty(`AST-${ref}`, "payer@example.com");
  assert.equal(filled?.email, "payer@example.com");
  const again = await orders.setOrderEmailIfEmpty(`AST-${ref}`, "other@example.com");
  assert.equal(again?.email, "payer@example.com"); // first writer wins
  const missing = await orders.setOrderEmailIfEmpty("AST-DOES-NOT-EXIST", "x@example.com");
  assert.equal(missing, null);
});
