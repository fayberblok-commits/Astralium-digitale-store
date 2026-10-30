import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL; // exercise the in-memory fallback paths
process.env.PII_ENCRYPTION_KEY = "test-pii-key-for-unit-tests-0123456789";

const { encryptPii, decryptPii, hashSubject, piiConfigured, recordConsent, isOptedOut, memoryConsentEntries, __resetMemoryConsent } =
  await import("../src/lib/pii.ts");

test("AES-256-GCM encrypt → decrypt round trip", () => {
  const cipher = encryptPii("+212612345678");
  assert.match(cipher, /^v1:/);
  assert.ok(!cipher.includes("212612345678"), "ciphertext must not contain the raw number");
  assert.equal(decryptPii(cipher), "+212612345678");
});

test("decrypt rejects tampered ciphertext and wrong key", () => {
  const cipher = encryptPii("+15551234567");
  const parts = cipher.split(":");
  parts[4] = Buffer.from("forged-plaintext").toString("base64url");
  assert.equal(decryptPii(parts.join(":")), null);
  const saved = process.env.PII_ENCRYPTION_KEY;
  process.env.PII_ENCRYPTION_KEY = "a-completely-different-key-9876543210";
  assert.equal(decryptPii(cipher), null);
  process.env.PII_ENCRYPTION_KEY = saved;
  assert.equal(decryptPii(cipher), "+15551234567");
});

test("hashSubject is a stable SHA-256 hex (lookup key, not reversible)", () => {
  const h = hashSubject("+212612345678");
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(h, hashSubject("+212612345678"));
  assert.notEqual(h, hashSubject("+212612345679"));
});

test("consent: opt-in then STOP opt-out is the latest state; raw phone never stored", async () => {
  __resetMemoryConsent();
  assert.equal(piiConfigured(), true);
  const phone = "+212612345678";
  const r1 = await recordConsent({ subject: phone, channel: "whatsapp", granted: true });
  assert.equal(r1.persisted, false); // no DB in tests — honest fallback
  assert.equal(await isOptedOut(phone, "whatsapp"), false);
  await recordConsent({ subject: phone, channel: "whatsapp", granted: false, storeCipher: false });
  assert.equal(await isOptedOut(phone, "whatsapp"), true);
  // The in-memory consent mirror must contain hashes only.
  const dump = JSON.stringify(memoryConsentEntries());
  assert.ok(!dump.includes("212612345678"), "consent records must never contain the raw phone");
  assert.ok(dump.includes(r1.subjectHash));
});
