import { test } from "node:test";
import assert from "node:assert/strict";

// Ensure the no-DB path is what these tests exercise.
delete process.env.DATABASE_URL;

const { FLAG_REGISTRY, flagDef, getFlag, listFlags, setFlag } = await import("../src/lib/flags.ts");

test("registry: 35 flags; safe features on, money/messaging default off", () => {
  assert.equal(FLAG_REGISTRY.length, 35);
  const onByDefault = FLAG_REGISTRY.filter((f) => f.defaultEnabled).map((f) => f.key);
  assert.deepEqual(onByDefault, [
    "delivery_email",
    // Phase 3 (features 1–8): non-money, non-messaging features default ON
    "library", "previews", "bundles", "recommendations", "smart_search", "reviews",
    // Phase 4 (features 9–16): receipts are a post-payment document — ON;
    // every Phase 4 money feature stays OFF until the owner enables it.
    "receipts",
    // Phase 5 (features 17–24): protective/read-only features ON —
    // watermarking, license keys, fraud shield (review-only), blog, SEO.
    "watermarking", "license_keys", "fraud_shield", "blog", "seo_engine",
    // Phase 6 (features 25–30): owner-facing infrastructure that sends
    // nothing externally by default — owner inbox, team access, privacy
    // center. ai_support_v2 stays OFF (pre-existing flag above).
    "owner_alerts", "team_access", "privacy_center",
  ]);
  for (const key of [
    "delivery_whatsapp", "delivery_messenger", "delivery_instagram",
    "social_proof", "ai_support_v2", "subscriptions", "loyalty", "referrals",
    // Phase 3 money + email features default OFF
    "order_bump", "wishlist_alerts",
    // Phase 4 money features default OFF
    "flash_sales", "gifts", "pwyw", "preorders", "express_pay",
    // Phase 5: sends email / experiments on visitors — OFF until enabled
    "email_automation", "ab_tests",
    // Phase 6: tracks visitors / contacts devices — OFF until enabled
    "analytics", "pwa_push",
  ]) {
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
  assert.equal(flags.length, 35);
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
