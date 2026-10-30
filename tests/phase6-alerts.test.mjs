import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p6-alerts-")));
delete process.env.DATABASE_URL;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;
delete process.env.WHATSAPP_ACCESS_TOKEN;

const alerts = await import("../src/lib/owner-alerts.ts");
const noFanOut = async () => ({
  telegram: { status: "skipped", reason: "TEST" },
  whatsapp: { status: "skipped", reason: "TEST" },
});

test("recorder: events are stored, listed newest-first, filtered and marked read", async () => {
  const a = await alerts.recordOwnerEvent(
    { kind: "order_paid", title: "New paid order ord-1 — $49.00", detail: { orderId: "ord-1" } },
    { fanOut: noFanOut },
  );
  const b = await alerts.recordOwnerEvent(
    { kind: "fraud_hold", title: "Fraud hold on order ord-2 (score 75)" },
    { fanOut: noFanOut },
  );
  assert.ok(a && b);
  assert.equal(await alerts.countUnreadOwnerEvents(), 2);
  const all = await alerts.listOwnerEvents();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, b.id, "newest first");
  const fraudOnly = await alerts.listOwnerEvents({ kind: "fraud_hold" });
  assert.equal(fraudOnly.length, 1);
  assert.equal(fraudOnly[0].kind, "fraud_hold");
  const marked = await alerts.markOwnerEventRead(a.id);
  assert.equal(marked.ok, true);
  assert.equal(await alerts.countUnreadOwnerEvents(), 1);
  const unread = await alerts.listOwnerEvents({ unreadOnly: true });
  assert.equal(unread.length, 1);
  assert.equal(unread[0].id, b.id);
  const allMarked = await alerts.markAllOwnerEventsRead();
  assert.equal(allMarked.marked, 1);
  assert.equal(await alerts.countUnreadOwnerEvents(), 0);
});

test("fan-out telegram: sent only with keys + enabled; honest skips otherwise", async () => {
  const ev = { id: "e1", kind: "order_paid", title: "New paid order ord-9", detail: null, readAt: null, createdAt: new Date().toISOString() };
  const base = { email: "", whatsappNumber: "", telegramEnabled: true };
  // No keys → skipped, and the injected fetch must never be called.
  let fetchCalls = 0;
  const fetchFn = async () => { fetchCalls++; return { ok: true, status: 200 }; };
  let r = await alerts.fanOutOwnerEvent(ev, { config: base, fetchFn, whatsappFlag: false });
  assert.equal(r.telegram.status, "skipped");
  assert.equal(fetchCalls, 0);
  // Keys present → sent to the Telegram API with the alert text.
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "12345";
  let sentBody = null;
  const fetchOk = async (url, init) => { sentBody = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200 }; };
  r = await alerts.fanOutOwnerEvent(ev, { config: base, fetchFn: fetchOk, whatsappFlag: false });
  assert.equal(r.telegram.status, "sent");
  assert.match(sentBody.url, /api\.telegram\.org\/bottest-token\/sendMessage/);
  assert.equal(sentBody.body.chat_id, "12345");
  assert.match(sentBody.body.text, /ord-9/);
  // Disabled in settings wins over keys.
  r = await alerts.fanOutOwnerEvent(ev, { config: { ...base, telegramEnabled: false }, fetchFn: fetchOk, whatsappFlag: false });
  assert.deepEqual(r.telegram, { status: "skipped", reason: "DISABLED_IN_SETTINGS" });
  // Provider failure is reported failed, never as sent.
  const fetchBad = async () => ({ ok: false, status: 401 });
  r = await alerts.fanOutOwnerEvent(ev, { config: base, fetchFn: fetchBad, whatsappFlag: false });
  assert.equal(r.telegram.status, "failed");
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

test("fan-out whatsapp: gated by Phase-2 flag, provider config and owner number", async () => {
  const ev = { id: "e2", kind: "delivery_failed", title: "Delivery failed for order ord-3", detail: null, readAt: null, createdAt: new Date().toISOString() };
  const cfg = { email: "", whatsappNumber: "212600000000", telegramEnabled: false };
  // Flag off → skipped before anything else.
  let r = await alerts.fanOutOwnerEvent(ev, { config: cfg, whatsappFlag: false });
  assert.deepEqual(r.whatsapp, { status: "skipped", reason: "FLAG_OFF" });
  // Flag on, provider keys missing → skipped.
  r = await alerts.fanOutOwnerEvent(ev, { config: cfg, whatsappFlag: true });
  assert.deepEqual(r.whatsapp, { status: "skipped", reason: "PROVIDER_NOT_CONFIGURED" });
  // Flag on + provider, but no owner number saved → skipped.
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_ACCESS_TOKEN = "tok";
  r = await alerts.fanOutOwnerEvent(ev, { config: { ...cfg, whatsappNumber: "" }, whatsappFlag: true });
  assert.deepEqual(r.whatsapp, { status: "skipped", reason: "NO_OWNER_NUMBER" });
  // Everything present → the Phase-2 send path is used with the alert text.
  let sentTo = null;
  let sentText = null;
  r = await alerts.fanOutOwnerEvent(ev, {
    config: cfg,
    whatsappFlag: true,
    sendWhatsapp: async (to, text) => { sentTo = to; sentText = text; return { ok: true }; },
  });
  assert.equal(r.whatsapp.status, "sent");
  assert.equal(sentTo, "212600000000");
  assert.match(sentText, /ord-3/);
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
});

test("digest: builds one summary, sends once per watermark, retries honestly on failure", async () => {
  const cfg = { email: "owner@example.com", whatsappNumber: "", telegramEnabled: false };
  await alerts.recordOwnerEvent({ kind: "review_pending", title: "Review pending moderation (5★, x)" }, { fanOut: noFanOut });
  const digest = alerts.buildDigest(await alerts.listOwnerEvents({ limit: 10 }));
  assert.ok(digest.count >= 3);
  assert.match(digest.html, /Review pending/);

  const sent = [];
  const okSend = async (msg) => { sent.push(msg); return { delivered: true, provider: "mock" }; };
  const r1 = await alerts.runOwnerDigest({ send: okSend, config: cfg });
  assert.equal(r1.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "owner@example.com");
  assert.equal(sent[0].kind, "owner-alert");
  const r2 = await alerts.runOwnerDigest({ send: okSend, config: cfg });
  assert.deepEqual(r2, { sent: false, events: 0, reason: "NOTHING_NEW" });
  assert.equal(sent.length, 1, "no duplicate digest without new events");
  // No digest address → honest skip.
  const r3 = await alerts.runOwnerDigest({ send: okSend, config: { ...cfg, email: "" } });
  assert.deepEqual(r3, { sent: false, events: 0, reason: "NO_DIGEST_EMAIL" });
});

test("digest: a failed send does not advance the watermark", async () => {
  const cfg = { email: "owner@example.com", whatsappNumber: "", telegramEnabled: false };
  await alerts.recordOwnerEvent({ kind: "order_paid", title: "New paid order ord-late" }, { fanOut: noFanOut });
  const failSend = async () => ({ delivered: false, provider: "log-only" });
  const r1 = await alerts.runOwnerDigest({ send: failSend, config: cfg });
  assert.equal(r1.sent, false);
  assert.equal(r1.reason, "EMAIL_NOT_DELIVERED");
  let retried = 0;
  const okSend = async () => { retried++; return { delivered: true, provider: "mock" }; };
  const r2 = await alerts.runOwnerDigest({ send: okSend, config: cfg });
  assert.equal(r2.sent, true);
  assert.ok(r2.events >= 1, "the late event is retried, not lost");
  assert.equal(retried, 1);
});

test("config sanitize: bad email dropped, number digits-only, telegram defaults on", () => {
  const c = alerts.sanitizeAlertsConfig({ email: "not-an-email", whatsappNumber: "+212 600-000", telegramEnabled: undefined });
  assert.equal(c.email, "");
  assert.equal(c.whatsappNumber, "212600000");
  assert.equal(c.telegramEnabled, true);
  const ok = alerts.sanitizeAlertsConfig({ email: "Owner@Example.com", whatsappNumber: "", telegramEnabled: false });
  assert.equal(ok.email, "owner@example.com");
  assert.equal(ok.telegramEnabled, false);
});
