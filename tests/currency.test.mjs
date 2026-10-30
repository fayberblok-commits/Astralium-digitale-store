import { test } from "node:test";
import assert from "node:assert/strict";
import { convertFromUSD, formatPrice, rateFor } from "../src/lib/currency.ts";

test("USD identity conversion", () => {
  assert.equal(convertFromUSD(19, "USD"), 19);
  assert.equal(rateFor("USD"), 1);
});

test("EUR conversion uses table rate", () => {
  assert.equal(convertFromUSD(100, "EUR"), 92);
});

test("JPY rounds to whole units", () => {
  const v = convertFromUSD(10, "JPY");
  assert.equal(Number.isInteger(v), true);
  assert.ok(v > 1000);
});

test("unknown currency falls back to USD rate", () => {
  assert.equal(convertFromUSD(42, "XXX"), 42);
});

test("formatting produces currency strings per locale", () => {
  const usd = formatPrice(19, "USD", "en");
  assert.match(usd, /\$|USD/);
  assert.match(usd, /19/);
  const eur = formatPrice(19, "EUR", "de");
  assert.match(eur, /€|EUR/);
});
