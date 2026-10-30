import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "astralium-p6-privacy-"));
process.chdir(dir);
delete process.env.DATABASE_URL;
process.env.PII_ENCRYPTION_KEY = "phase6-test-pii-key-0123456789";

const privacy = await import("../src/lib/privacy.ts");
const pii = await import("../src/lib/pii.ts");

const EMAIL = "buyer@example.com";
const EMAIL_HASH = pii.hashSubject(EMAIL);

function seedFileStores() {
  mkdirSync(path.join(dir, ".data"), { recursive: true });
  // Loyalty account in the Phase-4 file-store shape.
  writeFileSync(path.join(dir, ".data", "loyalty.json"), JSON.stringify([{
    id: "loy-1", emailHash: EMAIL_HASH, emailCipher: "", balance: 120, lifetimeEarned: 340,
    createdAt: "2026-09-01T00:00:00.000Z",
    entries: [{ id: "e1", kind: "earn", points: 120, orderId: "ord-1", idempotencyKey: "earn:ord-1", balanceAfter: 120, createdAt: "2026-09-01T00:00:00.000Z" }],
  }], null, 2));
  // License key in the Phase-5 file-store shape (hash + last4 only, as in prod).
  writeFileSync(path.join(dir, ".data", "license-keys.json"), JSON.stringify([{
    id: "lic-1", keyHash: "deadbeef", last4: "WXYZ", orderId: "ord-1", productId: "ai-profit-blueprint",
    emailHash: EMAIL_HASH, activationLimit: 3, activations: ["devhash1"], status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
  }], null, 2));
  // Wishlist alert + cart snapshot for the same buyer.
  writeFileSync(path.join(dir, ".data", "wishlist-alerts.json"), JSON.stringify([{
    id: "wa-1", emailHash: EMAIL_HASH, emailCipher: "cipher", productId: "ai-profit-blueprint",
    priceAtSave: 19, baseline: 19, createdAt: "2026-09-01T00:00:00.000Z",
  }], null, 2));
  writeFileSync(path.join(dir, ".data", "cart-snapshots.json"), JSON.stringify([{
    id: "cs-1", emailHash: EMAIL_HASH, emailCipher: "cipher", items: [], totalUSD: 19,
    locale: "en", status: "open", recoveryTokenHash: "x", recoverySentAt: null,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  }], null, 2));
}

function allStoreText() {
  return readdirSync(path.join(dir, ".data"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readFileSync(path.join(dir, ".data", f), "utf8"))
    .join("\n");
}

test("request tokens: single-use, kind-bound, expiring", async () => {
  const { token } = await privacy.createPrivacyRequest(EMAIL, "export");
  assert.ok(token.length >= 40);
  // The raw token is never what's stored.
  const raw = readFileSync(path.join(dir, ".data", "privacy-requests.json"), "utf8");
  assert.ok(!raw.includes(token), "only the token hash is persisted");
  const pending = await privacy.resolvePrivacyRequest(token);
  assert.equal(pending.kind, "export");
  assert.equal(privacy.requestEmail(pending), EMAIL);
  const consumed = await privacy.consumePrivacyRequest(token);
  assert.equal(consumed.status, "done");
  assert.equal(consumed.emailCipher, "", "cipher scrubbed on consumption");
  assert.equal(await privacy.consumePrivacyRequest(token), null, "second use refused");
  assert.equal(await privacy.resolvePrivacyRequest(token), null, "used token no longer resolves");
  assert.equal(await privacy.resolvePrivacyRequest("bogus-token-value-123456"), null);
  // Expiry: a request resolved after its TTL is refused and flipped.
  const old = await privacy.createPrivacyRequest(EMAIL, "delete", new Date(Date.now() - 2 * 3600 * 1000));
  assert.equal(await privacy.resolvePrivacyRequest(old.token), null);
});

test("export assembly: real stores only, zero-DB orders honestly unavailable", async () => {
  seedFileStores();
  await pii.recordConsent({ subject: EMAIL, channel: "marketing", granted: true, storeCipher: false });
  const data = await privacy.assembleExport(EMAIL);
  assert.equal(data.email, EMAIL);
  assert.equal(data.orders.available, false, "no DB → no order ledger, stated honestly");
  assert.match(data.orders.note, /No database is configured/);
  assert.equal(data.licenses.length, 1);
  assert.equal(data.licenses[0].keyLast4, "WXYZ");
  assert.ok(!JSON.stringify(data).includes("deadbeef"), "even the key HASH is not exported");
  assert.equal(data.loyalty.balance, 120);
  assert.equal(data.loyalty.lifetimeEarned, 340);
  assert.equal(data.loyalty.entries.length, 1);
  assert.ok(data.consents.some((c) => c.channel === "marketing" && c.granted === true));
  const forStranger = await privacy.assembleExport("nobody@example.com");
  assert.equal(forStranger.licenses.length, 0);
  assert.equal(forStranger.loyalty, null);
});

test("deletion invariants: PII gone everywhere, records preserved-but-anonymised", async () => {
  const summary = await privacy.executeDeletion(EMAIL);
  assert.equal(summary.dbMode, false);
  assert.equal(summary.loyaltyDeleted, true);
  assert.equal(summary.licensesAnonymized, 1, "license row kept, re-keyed to the tombstone");
  assert.equal(summary.wishlistAlertsDeleted, 1);
  assert.equal(summary.cartSnapshotsDeleted, 1);
  // The license row still exists (financial/activation record) under the tombstone hash.
  const licenses = JSON.parse(readFileSync(path.join(dir, ".data", "license-keys.json"), "utf8"));
  assert.equal(licenses.length, 1);
  assert.equal(licenses[0].emailHash, privacy.tombstoneHash(EMAIL_HASH));
  assert.equal(licenses[0].last4, "WXYZ", "non-PII record fields are preserved");
  // The loyalty account is gone entirely.
  const loyalty = JSON.parse(readFileSync(path.join(dir, ".data", "loyalty.json"), "utf8"));
  assert.equal(loyalty.length, 0);
  // Neither the raw email nor the original email hash survives in ANY store file.
  const everything = allStoreText();
  assert.ok(!everything.includes(EMAIL), "raw email must be gone from every store");
  assert.ok(!everything.includes(EMAIL_HASH), "original email hash must be gone from every store");
  // Consent memory mirror for the subject is dropped too.
  const prefs = await privacy.getConsentPreferences(EMAIL);
  assert.deepEqual(prefs, { analytics: true, marketing: true }, "deleted consents fall back to defaults, not stale values");
});

test("consent preferences: recorded per channel; marketing gates feature-20 automation", async () => {
  const email = "prefs@example.com";
  await privacy.setConsentPreferences(email, { analytics: false, marketing: false });
  const prefs = await privacy.getConsentPreferences(email);
  assert.deepEqual(prefs, { analytics: false, marketing: false });
  // Feature 20's send path checks isOptedOut(to, "email") — marketing
  // opt-out in the privacy center must stop those sends.
  assert.equal(await pii.isOptedOut(email, "email"), true);
  await privacy.setConsentPreferences(email, { analytics: true, marketing: true });
  assert.equal(await pii.isOptedOut(email, "email"), false);
  const prefs2 = await privacy.getConsentPreferences(email);
  assert.deepEqual(prefs2, { analytics: true, marketing: true });
});

test("tombstones + retention config sanitising", () => {
  const tomb = privacy.tombstoneEmail(EMAIL_HASH);
  assert.match(tomb, /^deleted\+[0-9a-f]{16}@anonymized\.invalid$/);
  assert.notEqual(privacy.tombstoneHash(EMAIL_HASH), EMAIL_HASH);
  assert.equal(privacy.sanitizePrivacyConfig({ retentionDays: 3 }).retentionDays, 7, "clamped to min 7");
  assert.equal(privacy.sanitizePrivacyConfig({ retentionDays: 99999 }).retentionDays, 3650, "clamped to max 3650");
  assert.equal(privacy.sanitizePrivacyConfig({ retentionDays: "junk" }).retentionDays, 365);
  assert.equal(privacy.sanitizePrivacyConfig({}).retentionDays, 365);
});

test("retention cleanup: pending requests past TTL expire", async () => {
  const { token } = await privacy.createPrivacyRequest("late@example.com", "export", new Date(Date.now() - 90 * 60 * 1000));
  assert.ok(token);
  const r = await privacy.cleanupPrivacyRequests(365);
  assert.ok(r.expired >= 1);
  assert.equal(await privacy.resolvePrivacyRequest(token), null);
});
