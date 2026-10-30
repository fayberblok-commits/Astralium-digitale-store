import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = mkdtempSync(path.join(tmpdir(), "astralium-p5-auto-"));
process.chdir(cwd);
delete process.env.DATABASE_URL;
process.env.PII_ENCRYPTION_KEY = "phase5-test-pii-key-0123456789abcdef";
process.env.NEXT_PUBLIC_SITE_URL = "https://store.example";

const auto = await import("../src/lib/email-automation.ts");
const { __resetMemoryConsent, isOptedOut } = await import("../src/lib/pii.ts");

const RUN = Date.now();
const EMAIL = `shopper-${RUN}@example.com`;

function mockSender() {
  const sent = [];
  return { sent, send: async (msg) => { sent.push(msg); return { delivered: true, provider: "mock" }; } };
}

test("capture: snapshot stores hash + ciphertext only; totals come from the catalog", async () => {
  const res = await auto.captureCartSnapshot({ email: EMAIL, productIds: ["p01", "p02"], locale: "en" });
  assert.equal(res.ok, true);
  assert.equal(res.snapshot.totalUSD, 98); // 19 + 79 from the file catalog
  assert.deepEqual(res.snapshot.items.map((i) => i.productId), ["p01", "p02"]);
  const raw = readFileSync(path.join(cwd, ".data", "cart-snapshots.json"), "utf8");
  assert.ok(!raw.includes(EMAIL), "raw email must never be stored");
  assert.ok(!raw.includes(res.recoveryToken), "raw recovery token must never be stored");
  assert.ok(raw.includes(res.snapshot.emailHash));
});

test("capture validation: bad email, unknown product, missing PII key", async () => {
  assert.equal((await auto.captureCartSnapshot({ email: "nope", productIds: ["p01"] })).error, "INVALID_EMAIL");
  assert.equal((await auto.captureCartSnapshot({ email: EMAIL, productIds: ["nope"] })).error, "INVALID_ITEMS");
  const saved = process.env.PII_ENCRYPTION_KEY;
  delete process.env.PII_ENCRYPTION_KEY;
  assert.equal((await auto.captureCartSnapshot({ email: EMAIL, productIds: ["p01"] })).error, "PII_NOT_CONFIGURED");
  process.env.PII_ENCRYPTION_KEY = saved;
});

test("recovery token resolves once; after recovery the link is dead", async () => {
  const res = await auto.captureCartSnapshot({ email: `rec-${RUN}@example.com`, productIds: ["p03"], locale: "ar" });
  const snap = await auto.resolveRecoveryToken(res.recoveryToken);
  assert.ok(snap);
  assert.equal(snap.id, res.snapshot.id);
  // Tampered + foreign-purpose tokens never resolve.
  assert.equal(await auto.resolveRecoveryToken(`${res.recoveryToken}x`), null);
  assert.equal(await auto.resolveRecoveryToken(auto.unsubscribeTokenFor(EMAIL)), null);
  await auto.markSnapshotRecovered(snap.id);
  assert.equal(await auto.resolveRecoveryToken(res.recoveryToken), null);
});

test("due selection: only open, unsent snapshots at least 1h old (pure)", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const mk = (over) => ({
    id: "x", emailHash: "h", emailCipher: "c", items: [], totalUSD: 1, locale: "en",
    status: "open", recoveryTokenHash: "t", recoverySentAt: null,
    createdAt: "2026-10-30T10:00:00.000Z", updatedAt: "2026-10-30T10:00:00.000Z", ...over,
  });
  const due = auto.dueRecoverySnapshots([
    mk({ id: "old" }),
    mk({ id: "fresh", createdAt: "2026-10-30T11:30:00.000Z" }),
    mk({ id: "sent", recoverySentAt: "2026-10-30T11:00:00.000Z" }),
    mk({ id: "done", status: "recovered" }),
  ], now);
  assert.deepEqual(due.map((s) => s.id), ["old"]);
});

test("job end-to-end (mock sender): recovery email carries List-Unsubscribe + link; replay is a no-op", async () => {
  const email = `job-${RUN}@example.com`;
  const cap = await auto.captureCartSnapshot({ email, productIds: ["p01"], locale: "en" });
  assert.equal(cap.ok, true);
  // Age the snapshot past the 1h mark by editing the file store fixture.
  const file = path.join(cwd, ".data", "cart-snapshots.json");
  const rows = JSON.parse(readFileSync(file, "utf8"));
  for (const row of rows) {
    if (row.id === cap.snapshot.id) row.createdAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  }
  writeFileSync(file, JSON.stringify(rows, null, 2));

  const mock = mockSender();
  const summary = await auto.runEmailAutomationJobs({ send: mock.send });
  assert.equal(summary.dbConfigured, false); // no DB → review/win-back honestly report no orders
  assert.equal(summary.reviewRequests.orders, 0);
  const recoveryMail = mock.sent.find((m) => m.to === email);
  assert.ok(recoveryMail, "the aged snapshot must produce a recovery email");
  assert.equal(recoveryMail.kind, "abandoned-cart");
  assert.ok(recoveryMail.headers["List-Unsubscribe"], "List-Unsubscribe header is mandatory");
  assert.equal(recoveryMail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(recoveryMail.html.includes("/api/unsubscribe?token="), "body carries the unsubscribe link");
  assert.ok(recoveryMail.html.includes("/en/cart?recover="), "body carries the recovery link");

  const again = mockSender();
  const summary2 = await auto.runEmailAutomationJobs({ send: again.send });
  assert.equal(summary2.recovery.sent, 0);
  assert.equal(again.sent.filter((m) => m.to === email).length, 0);
});

test("unsubscribe: one click records consent; automations skip the address forever", async () => {
  __resetMemoryConsent();
  const email = `unsub-${RUN}@example.com`;
  assert.equal(await isOptedOut(email, "email"), false);
  const bad = await auto.handleUnsubscribe("garbage.token");
  assert.equal(bad.ok, false);
  const ok = await auto.handleUnsubscribe(auto.unsubscribeTokenFor(email));
  assert.equal(ok.ok, true);
  assert.equal(ok.email, email);
  assert.equal(await isOptedOut(email, "email"), true);

  // An aged snapshot for the unsubscribed address is considered but never sent.
  const cap = await auto.captureCartSnapshot({ email, productIds: ["p02"], locale: "en" });
  const file = path.join(cwd, ".data", "cart-snapshots.json");
  const rows = JSON.parse(readFileSync(file, "utf8"));
  for (const row of rows) {
    if (row.id === cap.snapshot.id) row.createdAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  }
  writeFileSync(file, JSON.stringify(rows, null, 2));
  const mock = mockSender();
  const summary = await auto.runEmailAutomationJobs({ send: mock.send });
  assert.equal(mock.sent.filter((m) => m.to === email).length, 0);
  assert.equal(summary.recovery.skippedOptOut, 1);
  assert.ok(existsSync(file));
});
