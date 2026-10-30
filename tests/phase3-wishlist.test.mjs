import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

delete process.env.DATABASE_URL;
process.env.PII_ENCRYPTION_KEY = "test-pii-key-for-phase3-tests-0123456789";

const { encodeShareItems, parseShareItems } = await import("../src/lib/share.ts");
const alerts = await import("../src/lib/wishlist-alerts.ts");
const { decryptPii, hashSubject } = await import("../src/lib/pii.ts");
const { getFlag } = await import("../src/lib/flags.ts");

const EMAIL = "phase3-watcher@example.com";
after(() => {
  const path = join(process.cwd(), ".data", "wishlist-alerts.json");
  if (!existsSync(path)) return;
  const rows = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify(rows.filter((r) => r.emailHash !== hashSubject(EMAIL)), null, 2));
});

test("share link round-trip: slugs encode, parse back to the same products; junk dropped", () => {
  const encoded = encodeShareItems(["ai-profit-blueprint", "not-a-product", "deep-focus-masterclass"]);
  assert.equal(encoded, "ai-profit-blueprint,deep-focus-masterclass");
  const parsed = parseShareItems(encoded);
  assert.deepEqual(parsed.map((p) => p.slug), ["ai-profit-blueprint", "deep-focus-masterclass"]);
  assert.deepEqual(parseShareItems("ai-profit-blueprint,ai-profit-blueprint").length, 1);
  assert.deepEqual(parseShareItems(""), []);
  assert.deepEqual(parseShareItems(null), []);
});

test("price drops fire only on an actual decrease — not on equal or higher prices", () => {
  const snaps = [{ id: "a1", productId: "p01", priceAtSave: 19 }];
  assert.equal(alerts.findPriceDrops(snaps, () => 19).length, 0);
  assert.equal(alerts.findPriceDrops(snaps, () => 25).length, 0);
  const drops = alerts.findPriceDrops(snaps, () => 15);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].fromUSD, 19);
  assert.equal(drops[0].toUSD, 15);
  assert.equal(alerts.findPriceDrops(snaps, () => undefined).length, 0);
});

test("registration requires explicit opt-in and stores the email encrypted only", async () => {
  const noOptIn = await alerts.registerAlert({ email: EMAIL, productId: "p01", optIn: false });
  assert.equal(noOptIn.ok, false);
  assert.equal(noOptIn.error, "OPTIN_REQUIRED");
  const badProduct = await alerts.registerAlert({ email: EMAIL, productId: "nope", optIn: true });
  assert.equal(badProduct.error, "PRODUCT_NOT_FOUND");
  const ok = await alerts.registerAlert({ email: EMAIL, productId: "p01", optIn: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.persisted, "file");

  const rows = JSON.parse(readFileSync(join(process.cwd(), ".data", "wishlist-alerts.json"), "utf8"));
  const mine = rows.find((r) => r.emailHash === hashSubject(EMAIL));
  assert.ok(mine);
  assert.equal(mine.priceAtSave, 19);
  assert.ok(!JSON.stringify(mine).includes(EMAIL)); // never stored in clear
  assert.equal(decryptPii(mine.emailCipher), EMAIL);
});

test("job with snapshots at current prices sends nothing", async () => {
  const res = await alerts.runPriceDropJob();
  assert.ok(res.checked >= 1);
  assert.equal(res.drops, 0);
  assert.equal(res.emailed, 0);
});

test("wishlist_alerts flag defaults OFF → registration/job endpoints refuse (403 by route check)", async () => {
  assert.equal(await getFlag("wishlist_alerts"), false);
});
