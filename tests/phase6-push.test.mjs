import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "astralium-p6-push-"));
process.chdir(dir);
delete process.env.DATABASE_URL;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
process.env.PII_ENCRYPTION_KEY = "phase6-test-pii-key-0123456789";

const webpush = (await import("web-push")).default;
const push = await import("../src/lib/push.ts");

const ENDPOINT = "https://push.example.com/subscription/secret-token-abc123";
const KEYS = { p256dh: "BP256dhKeyMaterialExample1234567890", auth: "authSecretExample123" };

test("payload: brand defaults, internal URLs only, length caps", () => {
  const p = JSON.parse(push.buildPushPayload({ title: "New release", body: "Deep Focus 2.0 is out", url: "/en/shop" }));
  assert.equal(p.title, "New release");
  assert.equal(p.url, "/en/shop");
  assert.equal(p.icon, "/icons/icon-192.png");
  const external = JSON.parse(push.buildPushPayload({ title: "x", body: "y", url: "https://evil.example.com/phish" }));
  assert.equal(external.url, "/", "external URLs are never honoured");
  const long = JSON.parse(push.buildPushPayload({ title: "t".repeat(400), body: "b".repeat(900) }));
  assert.ok(long.title.length <= 120 && long.body.length <= 300);
});

test("readiness: VAPID missing → honest refusal everywhere", async () => {
  assert.equal(push.vapidConfigured(), false);
  assert.equal(push.pushReady().reason, "VAPID_NOT_CONFIGURED");
  const r = await push.broadcastPush({ title: "Hi", body: "there" }, { subscriptions: [] });
  assert.deepEqual(r, { ok: false, error: "VAPID_NOT_CONFIGURED" });
});

test("subscription storage: endpoint exists only as hash + ciphertext on disk", async () => {
  const saved = await push.savePushSubscription({ endpoint: ENDPOINT, keys: KEYS });
  assert.equal(saved.ok, true);
  const file = path.join(dir, ".data", "push-subscriptions.json");
  const raw = readFileSync(file, "utf8");
  assert.ok(!raw.includes(ENDPOINT), "raw endpoint must never be persisted");
  assert.ok(!raw.includes(KEYS.p256dh), "raw subscription keys must never be persisted");
  assert.ok(raw.includes(push.endpointHash(ENDPOINT)), "lookup is by SHA-256 hash");
  const subs = await push.listPushSubscriptions();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].endpoint, ENDPOINT, "server-side decryption round-trips");
  assert.deepEqual(subs[0].keys, KEYS);
  assert.equal(await push.countPushSubscriptions(), 1);
  // Re-subscribing the same endpoint upserts instead of duplicating.
  await push.savePushSubscription({ endpoint: ENDPOINT, keys: KEYS });
  assert.equal(await push.countPushSubscriptions(), 1);
});

test("broadcast: sent/failed accounting, 404+410 auto-cleanup, others kept", async () => {
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  const mk = (endpoint) => ({
    id: Math.random().toString(36), endpointHash: push.endpointHash(endpoint),
    endpoint, keys: KEYS, createdAt: new Date().toISOString(),
  });
  const subs = [mk("https://push.example.com/ok"), mk("https://push.example.com/gone"), mk("https://push.example.com/expired"), mk("https://push.example.com/flaky")];
  // Seed the "gone"/"expired" rows in the real store too so cleanup is observable.
  await push.savePushSubscription({ endpoint: "https://push.example.com/gone", keys: KEYS });
  await push.savePushSubscription({ endpoint: "https://push.example.com/expired", keys: KEYS });
  const before = await push.countPushSubscriptions();
  const sender = async (sub) => {
    if (sub.endpoint.endsWith("/ok")) return { statusCode: 201 };
    if (sub.endpoint.endsWith("/gone")) return { statusCode: 404 };
    if (sub.endpoint.endsWith("/expired")) return { statusCode: 410 };
    return { statusCode: 500 };
  };
  const r = await push.broadcastPush({ title: "Hello", body: "World" }, { sender, subscriptions: subs });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, { sent: 1, removed: 2, failed: 1, total: 4 });
  const after = await push.countPushSubscriptions();
  assert.equal(after, before - 2, "404/410 subscriptions are deleted from the store");
  const remaining = await push.listPushSubscriptions();
  assert.ok(remaining.every((s) => !s.endpoint.endsWith("/gone") && !s.endpoint.endsWith("/expired")));
});

test("broadcast: sender exceptions count as failed, never as sent", async () => {
  const sub = [{
    id: "x", endpointHash: push.endpointHash("https://push.example.com/throws"),
    endpoint: "https://push.example.com/throws", keys: KEYS, createdAt: new Date().toISOString(),
  }];
  const r = await push.broadcastPush({ title: "t", body: "b" }, {
    sender: async () => { throw new Error("network down"); },
    subscriptions: sub,
  });
  assert.deepEqual(r.result, { sent: 0, removed: 0, failed: 1, total: 1 });
});

test("unsubscribe removes by endpoint; invalid endpoints refused", async () => {
  const r = await push.removePushSubscription(ENDPOINT);
  assert.equal(r.removed, true);
  const subs = await push.listPushSubscriptions();
  assert.ok(subs.every((s) => s.endpoint !== ENDPOINT));
  const bad = await push.savePushSubscription({ endpoint: "http://insecure.example.com/x", keys: KEYS });
  assert.equal(bad.ok, false);
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});
