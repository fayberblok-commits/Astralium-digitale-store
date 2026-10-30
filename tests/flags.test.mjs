import { test } from "node:test";
import assert from "node:assert/strict";

// Ensure the no-DB path is what these tests exercise.
delete process.env.DATABASE_URL;

const { FLAG_REGISTRY, flagDef, getFlag, listFlags, setFlag } = await import("../src/lib/flags.ts");

test("registry: 9 flags, only delivery_email defaults on", () => {
  assert.equal(FLAG_REGISTRY.length, 9);
  const onByDefault = FLAG_REGISTRY.filter((f) => f.defaultEnabled).map((f) => f.key);
  assert.deepEqual(onByDefault, ["delivery_email"]);
  for (const key of ["delivery_whatsapp", "delivery_messenger", "delivery_instagram", "social_proof", "ai_support_v2", "subscriptions", "loyalty", "referrals"]) {
    assert.equal(flagDef(key)?.defaultEnabled, false, key);
  }
});

test("getFlag without DB returns registry defaults; unknown key is false", async () => {
  assert.equal(await getFlag("delivery_email"), true);
  assert.equal(await getFlag("delivery_whatsapp"), false);
  assert.equal(await getFlag("subscriptions"), false);
  assert.equal(await getFlag("no_such_flag"), false);
});

test("listFlags without DB: dbConfigured=false, persisted=false, defaults applied", async () => {
  const { dbConfigured, flags } = await listFlags();
  assert.equal(dbConfigured, false);
  assert.equal(flags.length, 9);
  for (const f of flags) {
    assert.equal(f.persisted, false);
    assert.equal(f.enabled, f.defaultEnabled);
  }
});

test("setFlag without DB: ok but honestly not persisted; unknown key rejected", async () => {
  const r = await setFlag("loyalty", true);
  assert.equal(r.ok, true);
  assert.equal(r.persisted, false);
  // State must not leak: without a DB the effective value is still the default.
  assert.equal(await getFlag("loyalty"), false);
  const bad = await setFlag("nope", true);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "UNKNOWN_FLAG");
});
