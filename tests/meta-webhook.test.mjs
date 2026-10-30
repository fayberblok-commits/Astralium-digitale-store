import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

delete process.env.DATABASE_URL;
process.env.WHATSAPP_PHONE_NUMBER_ID = "1234567890";
process.env.WHATSAPP_ACCESS_TOKEN = "test-wa-token";
process.env.META_PAGE_ACCESS_TOKEN = "test-page-token";
process.env.META_PAGE_ID = "page-1";
process.env.INSTAGRAM_ACCESS_TOKEN = "test-ig-token";
process.env.INSTAGRAM_USERNAME = "astralium.store";

const {
  verifyMetaSignature, webhookVerification, handleWhatsAppPayload, handleMetaPayload, __resetWebhookDedupe,
} = await import("../src/services/delivery/meta-webhook.ts");
const { issueClaimCode, createRefToken, __resetMemoryClaims } = await import("../src/lib/claim-codes.ts");
const { isOptedOut, __resetMemoryConsent } = await import("../src/lib/pii.ts");
const { recordAttempt, listAttempts, __resetMemoryAttempts } = await import("../src/services/delivery/attempts.ts");

const realFetch = globalThis.fetch;
let sent = [];
function stubFetch() {
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.reply" }], message_id: "mid.reply" }), headers: { get: () => null } };
  };
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

function waPayload(text, { from = "212612345678", id = "wamid.in-1" } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { messages: [{ from, id, type: "text", text: { body: text } }] } }] }],
  };
}

test("signature: valid HMAC accepted, forged/missing rejected", () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  const sig = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, sig, "app-secret"), true);
  assert.equal(verifyMetaSignature(body, sig, "wrong-secret"), false);
  assert.equal(verifyMetaSignature(body, null, "app-secret"), false);
  assert.equal(verifyMetaSignature(body, "sha256=deadbeef", "app-secret"), false);
});

test("GET verification handshake: right token returns challenge, wrong returns null", () => {
  assert.equal(webhookVerification("subscribe", "tok-123", "CH-42", "tok-123"), "CH-42");
  assert.equal(webhookVerification("subscribe", "nope", "CH-42", "tok-123"), null);
  assert.equal(webhookVerification("unsubscribe", "tok-123", "CH-42", "tok-123"), null);
});

test("whatsapp claim flow: code in message → download link reply; replay of same message deduped", async () => {
  __resetMemoryClaims();
  __resetWebhookDedupe();
  const { code } = await issueClaimCode({ orderId: "AST-WH1", productIds: ["p01"] });
  stubFetch();
  try {
    const payload = waPayload(`Hi Astralium! My delivery code is ${code}`);
    const s1 = await handleWhatsAppPayload(payload);
    assert.equal(s1.claimsRedeemed, 1);
    assert.equal(s1.replies, 1);
    assert.match(sent[0].body.text.body, /\/api\/download\//);
    assert.equal(sent[0].body.to, "212612345678");
    // Meta retries the identical webhook → dedupe by message id, no second reply.
    const s2 = await handleWhatsAppPayload(payload);
    assert.equal(s2.duplicates, 1);
    assert.equal(s2.replies, 0);
    // A NEW message reusing the (now used) code → polite refusal, no links.
    const s3 = await handleWhatsAppPayload(waPayload(`code: ${code}`, { id: "wamid.in-2" }));
    assert.equal(s3.claimsRedeemed, 0);
    assert.equal(s3.replies, 1);
    assert.ok(!/api\/download/.test(sent[sent.length - 1].body.text.body));
  } finally {
    restoreFetch();
  }
});

test("whatsapp claim flow: expired code gets refusal, no links", async () => {
  const { code } = await issueClaimCode({ orderId: "AST-WH2", productIds: ["p01"], ttlSeconds: -30 });
  stubFetch();
  try {
    const s = await handleWhatsAppPayload(waPayload(code, { id: "wamid.in-exp" }));
    assert.equal(s.claimsRedeemed, 0);
    assert.equal(s.replies, 1);
    assert.ok(!/api\/download/.test(sent[0].body.text.body));
  } finally {
    restoreFetch();
  }
});

test("whatsapp STOP records opt-out and confirms; Arabic إيقاف works too", async () => {
  __resetMemoryConsent();
  stubFetch();
  try {
    const s = await handleWhatsAppPayload(waPayload("STOP", { from: "33612345678", id: "wamid.stop-1" }));
    assert.equal(s.optOuts, 1);
    assert.equal(await isOptedOut("+33612345678", "whatsapp"), true);
    assert.equal(s.replies, 1); // unsubscribe confirmation
    const s2 = await handleWhatsAppPayload(waPayload("إيقاف", { from: "212600011122", id: "wamid.stop-2" }));
    assert.equal(s2.optOuts, 1);
    assert.equal(await isOptedOut("+212600011122", "whatsapp"), true);
  } finally {
    restoreFetch();
  }
});

test("whatsapp status webhook updates the matching delivery attempt", async () => {
  __resetMemoryAttempts();
  await recordAttempt({
    orderId: "AST-WH3", channel: "whatsapp", status: "sent",
    idempotencyKey: "AST-WH3:whatsapp:g:try1", grantId: "g", providerRef: "wamid.out-9",
  });
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.out-9", status: "read" }] } }] }],
  };
  const s = await handleWhatsAppPayload(payload);
  assert.equal(s.statusesUpdated, 1);
  const rows = await listAttempts(10);
  assert.equal(rows.find((r) => r.providerRef === "wamid.out-9")?.status, "read");
});

test("messenger referral: signed ref → links sent to the PSID", async () => {
  stubFetch();
  try {
    const ref = createRefToken({ oid: "AST-MG1", pids: ["p02"], ch: "messenger" });
    const payload = {
      object: "page",
      entry: [{ messaging: [{ sender: { id: "psid-7" }, referral: { ref, source: "SHORTLINK" } }] }],
    };
    const s = await handleMetaPayload(payload);
    assert.equal(s.replies, 1);
    assert.equal(sent[0].body.recipient.id, "psid-7");
    assert.match(sent[0].body.message.text, /\/api\/download\//);
    // Forged ref → ignored, nothing sent.
    sent.length = 0;
    const bad = { object: "page", entry: [{ messaging: [{ sender: { id: "psid-7" }, referral: { ref: `${ref}x` } }] }] };
    const s2 = await handleMetaPayload(bad);
    assert.equal(s2.replies, 0);
    assert.equal(sent.length, 0);
  } finally {
    restoreFetch();
  }
});

test("instagram fallback: first message carrying the claim code gets the links", async () => {
  __resetMemoryClaims();
  const { code } = await issueClaimCode({ orderId: "AST-IG1", productIds: ["p03"] });
  stubFetch();
  try {
    const payload = {
      object: "instagram",
      entry: [{ messaging: [{ sender: { id: "igsid-3" }, message: { mid: "mid.ig-1", text: `Hello, my code is ${code}` } }] }],
    };
    const s = await handleMetaPayload(payload);
    assert.equal(s.claimsRedeemed, 1);
    assert.equal(s.replies, 1);
    assert.equal(sent[0].body.recipient.id, "igsid-3");
    assert.match(sent[0].body.message.text, /\/api\/download\//);
  } finally {
    restoreFetch();
  }
});
