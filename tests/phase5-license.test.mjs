import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = mkdtempSync(path.join(tmpdir(), "astralium-p5-lic-"));
process.chdir(cwd);
delete process.env.DATABASE_URL;

const lic = await import("../src/lib/license.ts");

const EMAIL = "buyer@example.com";
const ORDER = `AST-LIC-${Date.now()}`;

test("key generation: shape, display format, hash-only identity", () => {
  const gen = lic.generateLicenseKey();
  assert.match(gen.display, /^ASTL(-[A-Z0-9]{4}){4}$/);
  assert.equal(gen.canonical.length, 20);
  assert.equal(gen.last4, gen.canonical.slice(-4));
  assert.equal(gen.keyHash, lic.hashLicenseKey(gen.display));
  assert.equal(lic.isLicenseKeyShape(gen.display), true);
  assert.equal(lic.isLicenseKeyShape("ASTL-XXXX"), false);
  // Normalisation: dashes/case/spacing do not change identity.
  assert.equal(lic.hashLicenseKey(gen.display.toLowerCase().replaceAll("-", " ")), gen.keyHash);
});

test("config sanitize: unknown products dropped, limits clamped", () => {
  const cfg = lic.sanitizeLicenseConfig({
    requiredProductIds: ["p01", "no-such-product", "p01"],
    defaultActivationLimit: 999,
    perProductLimit: { p01: 2, nope: 5 },
  });
  assert.deepEqual(cfg.requiredProductIds, ["p01"]);
  assert.equal(cfg.defaultActivationLimit, 50);
  assert.deepEqual(cfg.perProductLimit, { p01: 2 });
  assert.equal(lic.activationLimitFor(cfg, "p01"), 2);
  assert.equal(lic.activationLimitFor(cfg, "p02"), 50);
});

test("issue → stored hash-only (plaintext nowhere on disk) → verify OK", async () => {
  const config = lic.sanitizeLicenseConfig({ requiredProductIds: ["p01"], defaultActivationLimit: 2 });
  await lic.setLicenseConfig(config);
  const { issued, record } = await lic.issueLicenseKey({ orderId: ORDER, productId: "p01", email: EMAIL, config });
  assert.ok(issued);
  assert.equal(record.activationLimit, 2);
  const raw = readFileSync(path.join(cwd, ".data", "license-keys.json"), "utf8");
  assert.ok(!raw.includes(issued.key), "plaintext key must never be persisted");
  assert.ok(!raw.includes(issued.key.replaceAll("-", "")), "canonical key must never be persisted");
  assert.ok(raw.includes(record.last4), "last-4 display is stored");
  assert.ok(raw.includes(record.keyHash));
  const verdict = await lic.verifyLicenseKey(issued.key);
  assert.equal(verdict.code, "OK");
  assert.equal(verdict.activationsRemaining, 2);
});

test("issuance is idempotent per (order, product) — a replay mints nothing new", async () => {
  const again = await lic.issueLicenseKey({ orderId: ORDER, productId: "p01", email: EMAIL });
  assert.equal(again.issued, null);
  const keys = await lic.listLicenseKeys();
  assert.equal(keys.filter((k) => k.orderId === ORDER).length, 1);
});

test("order-level issuance only covers configured products", async () => {
  const issued = await lic.issueLicenseKeysForOrder(`${ORDER}-B`, EMAIL, ["p01", "p02", "p03"]);
  assert.deepEqual(issued.map((k) => k.productId), ["p01"]);
});

test("activation: limit enforced, same device idempotent, distinct codes", async () => {
  const { issued } = await lic.issueLicenseKey({ orderId: `${ORDER}-C`, productId: "p01", email: EMAIL });
  const key = issued.key;
  let v = await lic.activateLicenseKey(key, "laptop-1");
  assert.equal(v.code, "OK");
  assert.equal(v.alreadyActivated, false);
  v = await lic.activateLicenseKey(key, "laptop-1");
  assert.equal(v.code, "OK");
  assert.equal(v.alreadyActivated, true);
  assert.equal(v.activationsUsed, 1); // no extra slot consumed
  v = await lic.activateLicenseKey(key, "phone-2");
  assert.equal(v.code, "OK");
  assert.equal(v.activationsUsed, 2);
  v = await lic.activateLicenseKey(key, "tablet-3");
  assert.equal(v.code, "ACTIVATION_LIMIT_REACHED");
  // An exhausted key also fails plain verification with the distinct code.
  v = await lic.verifyLicenseKey(key);
  assert.equal(v.code, "ACTIVATION_LIMIT_REACHED");
});

test("revoked keys fail with KEY_REVOKED; garbage fails KEY_NOT_FOUND", async () => {
  const { issued, record } = await lic.issueLicenseKey({ orderId: `${ORDER}-D`, productId: "p01", email: EMAIL });
  const ok = await lic.revokeLicenseKey(record.id);
  assert.equal(ok.ok, true);
  assert.equal((await lic.verifyLicenseKey(issued.key)).code, "KEY_REVOKED");
  assert.equal((await lic.activateLicenseKey(issued.key, "dev-1")).code, "KEY_REVOKED");
  assert.equal((await lic.verifyLicenseKey("ASTL-ZZZZ-ZZZZ-ZZZZ-ZZZZ")).code, "KEY_NOT_FOUND");
  assert.equal((await lic.verifyLicenseKey("not a key")).code, "KEY_NOT_FOUND");
  // Admin masking never reconstructs the key.
  assert.match(lic.maskLicenseKey(record.last4), /^ASTL-••••-••••-••••-[A-Z0-9]{4}$/);
});

test("email section contains the issued keys (the one place plaintext appears)", async () => {
  const html = lic.licenseKeysEmailHtml([{ productId: "p01", title: "Some Product", key: "ASTL-AAAA-BBBB-CCCC-DDDD" }]);
  assert.ok(html.includes("ASTL-AAAA-BBBB-CCCC-DDDD"));
  assert.equal(lic.licenseKeysEmailHtml([]), "");
});

test("rate limiter: sliding window allows N then blocks with retryAfter", () => {
  const limiter = lic.createRateLimiter(3, 60_000);
  const t0 = 1_000_000;
  assert.equal(limiter.hit("ip1", t0).allowed, true);
  assert.equal(limiter.hit("ip1", t0 + 1).allowed, true);
  assert.equal(limiter.hit("ip1", t0 + 2).allowed, true);
  const blocked = limiter.hit("ip1", t0 + 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  // A different key has its own budget; the window slides.
  assert.equal(limiter.hit("ip2", t0 + 3).allowed, true);
  assert.equal(limiter.hit("ip1", t0 + 60_001).allowed, true);
});
