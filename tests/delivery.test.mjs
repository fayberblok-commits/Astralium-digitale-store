import { test } from "node:test";
import assert from "node:assert/strict";

// Zero-DB mode: flags via env override, attempts in memory, email log-only.
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;
process.env.DELIVERY_RETRY_BACKOFF_MS = "1";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
process.env.WHATSAPP_ACCESS_TOKEN = "test-wa-token";
process.env.WHATSAPP_BUSINESS_NUMBER = "+15550001111";
process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
process.env.META_PAGE_ID = "page-1";
process.env.FLAG_DELIVERY_WHATSAPP = "1";
process.env.FLAG_DELIVERY_MESSENGER = "1";

const { deliverOrder, grantIdFor, channelAvailability } = await import("../src/services/delivery/index.ts");
const { whatsappChannel } = await import("../src/services/delivery/whatsapp.ts");
const { messengerChannel } = await import("../src/services/delivery/messenger.ts");
const { __resetMemoryAttempts, memoryAttemptList } = await import("../src/services/delivery/attempts.ts");
const { recordConsent, __resetMemoryConsent } = await import("../src/lib/pii.ts");

const realFetch = globalThis.fetch;
let fetchCalls = [];
let fetchBehavior = () => ({ ok: true, body: { messages: [{ id: "wamid.test-1" }] } });

function stubFetch() {
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    const b = fetchBehavior(String(url));
    return {
      ok: b.ok,
      status: b.status ?? (b.ok ? 200 : 400),
      json: async () => b.body ?? {},
      headers: { get: () => null },
    };
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

const ORDER = { orderId: "AST-DLV1", email: "buyer@example.com", phoneE164: "+212612345678", productIds: ["p01"] };

test("availability: whatsapp + messenger available with flag on + env set; instagram not configured", async () => {
  const a = await channelAvailability();
  const byKey = Object.fromEntries(a.map((c) => [c.key, c]));
  assert.equal(byKey.whatsapp.available, true);
  assert.equal(byKey.messenger.available, true);
  assert.equal(byKey.instagram.available, false);
  assert.equal(byKey.email.available, true); // base channel, flag defaults on
});

test("whatsapp adapter: template send posts order id + signed link, never a storage URL", async () => {
  stubFetch();
  try {
    const res = await whatsappChannel.send({
      orderId: "AST-DLV1", grantId: "g1", phoneE164: "+212612345678",
      items: [{ productId: "p01", title: "T", downloadUrl: "https://store.example/api/download/TOK" }],
    });
    assert.equal(res.ok, true);
    assert.equal(res.providerMessageId, "wamid.test-1");
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /graph\.facebook\.com\/v21\.0\/1234567890\/messages/);
    const tpl = fetchCalls[0].body.template;
    assert.equal(tpl.name, "astralium_delivery");
    const params = tpl.components[0].parameters.map((p) => p.text);
    assert.equal(params[0], "AST-DLV1");
    assert.match(params[1], /\/api\/download\//);
    assert.ok(!JSON.stringify(fetchCalls[0].body).includes("s3"), "no raw storage URL may be sent");
    assert.equal(fetchCalls[0].body.to, "212612345678");
  } finally {
    restoreFetch();
  }
});

test("orchestrator: whatsapp success recorded once; replay is idempotent (no second send)", async () => {
  __resetMemoryAttempts();
  stubFetch();
  try {
    const out1 = await deliverOrder(ORDER, "whatsapp");
    assert.equal(out1.deliveredVia, "whatsapp");
    assert.equal(out1.fellBack, false);
    assert.equal(fetchCalls.length, 1);
    const out2 = await deliverOrder(ORDER, "whatsapp");
    assert.equal(out2.alreadyDelivered, true);
    assert.equal(fetchCalls.length, 1, "idempotent replay must not re-send");
    // No raw phone anywhere in the attempt records.
    assert.ok(!JSON.stringify(memoryAttemptList()).includes("212612345678"));
  } finally {
    restoreFetch();
  }
});

test("orchestrator: whatsapp failure falls back to email automatically", async () => {
  __resetMemoryAttempts();
  fetchBehavior = () => ({ ok: false, status: 400, body: { error: { code: 131030, message: "not in allowlist" } } });
  stubFetch();
  try {
    const order = { ...ORDER, orderId: "AST-DLV2" };
    const out = await deliverOrder(order, "whatsapp");
    assert.equal(out.fellBack, true);
    assert.equal(out.deliveredVia, "email");
    const wa = out.attempts.filter((a) => a.channel === "whatsapp");
    assert.equal(wa.length, 1, "non-retryable error must not be retried");
    assert.match(wa[0].errorCode, /META_131030/);
    const em = out.attempts.filter((a) => a.channel === "email");
    assert.equal(em.length, 1);
    assert.equal(em[0].status, "queued"); // no RESEND_API_KEY in tests → honest queued, not "sent"
  } finally {
    fetchBehavior = () => ({ ok: true, body: { messages: [{ id: "wamid.test-1" }] } });
    restoreFetch();
  }
});

test("orchestrator: send timeout falls back to email with TIMEOUT recorded", async () => {
  __resetMemoryAttempts();
  globalThis.fetch = () => new Promise(() => {}); // never resolves
  try {
    const order = { ...ORDER, orderId: "AST-DLV3" };
    const out = await deliverOrder(order, "whatsapp", { timeoutMs: 60, maxRetries: 0 });
    assert.equal(out.fellBack, true);
    assert.equal(out.deliveredVia, "email");
    assert.ok(out.attempts.some((a) => a.channel === "whatsapp" && a.errorCode === "TIMEOUT"));
  } finally {
    restoreFetch();
  }
});

test("orchestrator: flag-off channel is gated and falls back to email", async () => {
  __resetMemoryAttempts();
  const order = { ...ORDER, orderId: "AST-DLV4" };
  const out = await deliverOrder(order, "instagram"); // flag off + not configured
  assert.equal(out.fellBack, true);
  assert.equal(out.deliveredVia, "email");
  assert.ok(out.attempts.some((a) => a.channel === "instagram" && a.errorCode === "CHANNEL_DISABLED"));
});

test("whatsapp adapter refuses opted-out numbers without calling Meta", async () => {
  __resetMemoryConsent();
  await recordConsent({ subject: "+212699988877", channel: "whatsapp", granted: false, storeCipher: false });
  stubFetch();
  try {
    const res = await whatsappChannel.send({
      orderId: "AST-DLV5", grantId: "g5", phoneE164: "+212699988877",
      items: [{ productId: "p01", title: "T", downloadUrl: "https://store.example/api/download/TOK" }],
    });
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "OPTED_OUT");
    assert.equal(fetchCalls.length, 0);
  } finally {
    restoreFetch();
  }
});

test("messenger adapter: missing PSID rejected; with PSID sends via Send API", async () => {
  const noPsid = await messengerChannel.send({ orderId: "AST-DLV6", grantId: "g6", items: [] });
  assert.equal(noPsid.ok, false);
  assert.equal(noPsid.errorCode, "NO_PSID");
  stubFetch();
  fetchBehavior = () => ({ ok: true, body: { message_id: "mid.123" } });
  try {
    const ok = await messengerChannel.send({
      orderId: "AST-DLV6", grantId: "g6", recipientId: "psid-42",
      items: [{ productId: "p01", title: "T", downloadUrl: "https://store.example/api/download/TOK" }],
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.providerMessageId, "mid.123");
    assert.equal(fetchCalls[0].body.recipient.id, "psid-42");
    assert.match(fetchCalls[0].body.message.text, /\/api\/download\//);
  } finally {
    fetchBehavior = () => ({ ok: true, body: { messages: [{ id: "wamid.test-1" }] } });
    restoreFetch();
  }
});

test("grantIdFor is stable per order+items and differs across item sets", () => {
  const a = grantIdFor({ orderId: "O1", productIds: ["p02", "p01"] });
  const b = grantIdFor({ orderId: "O1", productIds: ["p01", "p02"] });
  const c = grantIdFor({ orderId: "O1", productIds: ["p01"] });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
