import { test } from "node:test";
import assert from "node:assert/strict";

const { normalizePhone, isValidPhone, countryForLocalePhone } = await import("../src/lib/phone.ts");

test("national number + default country normalises to E.164", () => {
  const r = normalizePhone("0612345678", "MA");
  assert.equal(r.ok, true);
  assert.equal(r.e164, "+212612345678");
  assert.equal(r.country, "MA");
});

test("international format needs no default country (auto-detect)", () => {
  const r = normalizePhone("+1 (650) 253-0000");
  assert.equal(r.ok, true);
  assert.equal(r.e164, "+16502530000");
  assert.equal(r.country, "US");
});

test("invalid numbers are rejected (checkout must not accept them)", () => {
  assert.equal(normalizePhone("123", "MA").ok, false);
  assert.equal(normalizePhone("not a phone", "US").ok, false);
  assert.equal(normalizePhone("+999999999999").ok, false);
  assert.equal(normalizePhone("").ok, false);
  assert.equal(isValidPhone("0612345678", "MA"), true);
  assert.equal(isValidPhone("0612", "MA"), false);
});

test("locale → default phone country mapping", () => {
  assert.equal(countryForLocalePhone("ar"), "MA");
  assert.equal(countryForLocalePhone("fr"), "FR");
  assert.equal(countryForLocalePhone("xx"), "US");
});
