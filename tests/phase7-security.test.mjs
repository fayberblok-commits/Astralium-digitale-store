/**
 * Phase 1 upgrade — unit coverage for the new security modules:
 * HKDF key separation (§5), the order state machine (F1/§8), catalog
 * DB-merge semantics (F2), security-state sanitizing (§13) and env
 * validation escalation (§5).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const keys = await import("../src/lib/keys.ts");
const orders = await import("../src/lib/orders.ts");
const catalog = await import("../src/lib/catalog.ts");
const secState = await import("../src/lib/security-state.ts");
const { validateEnv } = await import("../src/lib/env.ts");
const { PRODUCTS } = await import("../src/data/products.ts");

// ── §5 HKDF separation ────────────────────────────────────────────────
test("HKDF: different purposes derive different keys; a signature for one purpose never verifies for another", () => {
  process.env.DOWNLOAD_SIGNING_SECRET = "phase7-test-download-secret-0123456789abcdef";
  keys.__resetKeyCachesForTests();
  const dl = keys.purposeHmac("download-token", "payload");
  const cc = keys.purposeHmac("claim-code", "payload");
  assert.ok(dl && cc);
  assert.notEqual(dl, cc);
  assert.equal(keys.purposeHmacVerify("download-token", "payload", dl), true);
  assert.equal(keys.purposeHmacVerify("claim-code", "payload", dl), false);
  assert.equal(keys.purposeHmacVerify("order-access", "payload", dl), false);
  delete process.env.DOWNLOAD_SIGNING_SECRET;
  keys.__resetKeyCachesForTests();
});

test("weak-secret detection: short/placeholder secrets are weak, long random ones are not", () => {
  assert.equal(keys.isWeakSecret(undefined), true);
  assert.equal(keys.isWeakSecret("short"), true);
  assert.equal(keys.isWeakSecret("astralium-dev-secret"), true); // known placeholder class
  assert.equal(keys.isWeakSecret("x".repeat(48)), true); // zero-entropy repetition is weak by design
  assert.equal(keys.isWeakSecret("9f2K!zQ7#vR4&xP8*wL3@nM6$sD1%hJ5"), false);
});

test("env validation: production escalates weak secrets to errors; zero-env stays clean", () => {
  assert.deepEqual(validateEnv({}).errors, []);
  const prod = validateEnv({
    NODE_ENV: "production",
    ADMIN_PASSWORD: "short",
    DOWNLOAD_SIGNING_SECRET: "tiny",
    AUTH_SECRET: "alsotiny",
  });
  assert.ok(prod.errors.some((e) => e.includes("ADMIN_PASSWORD")));
  assert.ok(prod.errors.some((e) => e.includes("DOWNLOAD_SIGNING_SECRET")));
  assert.ok(prod.errors.some((e) => e.includes("AUTH_SECRET")));
  const badPath = validateEnv({ ADMIN_PATH: "Not A Slug!" });
  assert.ok(badPath.errors.some((e) => e.includes("ADMIN_PATH")));
  const badProxy = validateEnv({ TRUSTED_PROXY_HEADER: "x bad header" });
  assert.ok(badProxy.errors.some((e) => e.includes("TRUSTED_PROXY_HEADER")));
});

// ── F1/§8 order state machine ─────────────────────────────────────────
test("order state machine: PAID only from PENDING; terminal states are absorbing", () => {
  const allowed = [
    ["pending", "paid"], ["pending", "failed"],
    ["paid", "fulfilled"], ["paid", "refunded"], ["paid", "disputed"],
    ["fulfilled", "refunded"], ["fulfilled", "disputed"],
    ["disputed", "refunded"],
    // disputed→paid exists in the raw machine ONLY as the owner-confirmed
    // restore edge (restoreAfterDispute); the webhook path
    // (markPaidAndGrant) refuses anything not PENDING — proven in the
    // penetration suite's resurrection test.
    ["disputed", "paid"],
  ];
  for (const [from, to] of allowed) assert.equal(orders.canTransition(from, to), true, `${from}→${to}`);
  const forbidden = [
    ["refunded", "paid"], ["failed", "paid"], ["refunded", "fulfilled"],
    ["failed", "refunded"], ["pending", "refunded"], ["pending", "fulfilled"],
  ];
  for (const [from, to] of forbidden) assert.equal(orders.canTransition(from, to), false, `${from}→${to}`);
  assert.equal(orders.isTerminal("refunded"), true);
  assert.equal(orders.isTerminal("failed"), true);
  assert.equal(orders.isTerminal("paid"), false);
});

// ── F2 catalog merge ──────────────────────────────────────────────────
test("catalog merge: DB commercial fields win; editorial fields fall back per-field to the seed", () => {
  const seed = PRODUCTS[0];
  const row = {
    id: seed.id,
    slug: "db-renamed-slug",
    title: "DB Title Wins",
    priceUSD: 123.45,
    fileKey: "products/x/file.pdf",
    active: true,
    subtitle: "", // unpopulated legacy row → seed fallback
    description: "",
    category: "",
    formats: [],
    compareAtUSD: null,
    rating: 0,
    reviewsCount: 0,
    badge: null,
    includes: [],
    preview: "",
    hue: 0,
    publishedAt: "",
    language: null,
  };
  const merged = catalog.rowToProduct(row, seed);
  assert.equal(merged.title, "DB Title Wins");
  assert.equal(merged.priceUSD, 123.45);
  assert.equal(merged.slug, "db-renamed-slug");
  assert.equal(merged.subtitle, seed.subtitle);
  assert.equal(merged.description, seed.description);
  // A populated DB editorial field wins over the seed.
  const row2 = { ...row, subtitle: "DB subtitle", rating: 4.9, reviewsCount: 77 };
  const merged2 = catalog.rowToProduct(row2, seed);
  assert.equal(merged2.subtitle, "DB subtitle");
  assert.equal(merged2.rating, 4.9);
  assert.equal(merged2.reviewsCount, 77);
  // Round trip: productToRowData carries the editorial fields to the DB.
  const back = catalog.productToRowData(seed);
  assert.equal(back.title, seed.title);
  assert.equal(back.description, seed.description);
  assert.ok(Array.isArray(back.formats));
});

// ── §13 security state ────────────────────────────────────────────────
test("security state sanitizer: malformed persisted state is dropped, never trusted", () => {
  const clean = secState.sanitizeSecurityState({
    sessionEpoch: "not-a-number",
    loginGuards: { "acct:a": { failures: [1, 2, "x"], lockedUntil: 5 }, junk: 42 },
    ownerTotp: { secretCipher: 123, lastStep: -1 },
    knownDevices: { "acct:a": ["fp1", 7] },
  });
  assert.equal(clean.sessionEpoch, 0);
  assert.deepEqual(clean.loginGuards["acct:a"].failures, [1, 2]);
  // A malformed guard entry is neutralized to an empty guard, never trusted.
  assert.deepEqual(clean.loginGuards.junk, { failures: [], lockedUntil: 0 });
  assert.deepEqual(clean.knownDevices, { "acct:a": ["fp1"] });
  // A TOTP record without a valid encrypted secret is dropped entirely.
  assert.equal(clean.ownerTotp, null);
  assert.deepEqual(secState.sanitizeSecurityState(null), secState.EMPTY_SECURITY_STATE);
});
