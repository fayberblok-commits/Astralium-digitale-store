import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// No-DB path: versions + bindings live in the .data JSON stores.
delete process.env.DATABASE_URL;
process.env.DOWNLOAD_SIGNING_SECRET = "test-signing-secret-for-phase3-tests-0123456789";

const { publishVersion, listVersions, versionAt, isNewerVersion } = await import("../src/lib/versions.ts");
const { buildLibraryEntries, localOrdersToInputs } = await import("../src/lib/library.ts");
const { createDownloadToken, verifyDownloadToken } = await import("../src/lib/tokens.ts");
const { getBinding } = await import("../src/lib/bindings.ts");
const { previewSizeAllowed, previewMaxBytes, buildPreviewFallbackDoc, isAudioProduct } = await import("../src/lib/preview.ts");
const { PRODUCTS, getProductById } = await import("../src/data/products.ts");

const DATA = join(process.cwd(), ".data");
function scrubKey(file, key) {
  const path = join(DATA, file);
  if (!existsSync(path)) return;
  const store = JSON.parse(readFileSync(path, "utf8"));
  if (store && typeof store === "object" && !Array.isArray(store)) {
    delete store[key];
    writeFileSync(path, JSON.stringify(store, null, 2));
  }
}
after(() => {
  scrubKey("product-versions.json", "p01");
  scrubKey("file-bindings.json", "p01");
});

test("version publish repoints the binding; previously minted grants stay valid", async () => {
  const tokenBefore = createDownloadToken("p01", "AST-TEST-1");
  const res = await publishVersion({ productId: "p01", version: "2.0.0", fileKey: "products/p01/v2-test.pdf", notes: "test" });
  assert.equal(res.persisted, "file");
  assert.equal(res.record.version, "2.0.0");
  assert.equal(res.emailsQueued, 0);
  assert.equal(res.emailNote, "no-db-no-buyer-list");
  const binding = await getBinding("p01");
  assert.equal(binding?.fileKey, "products/p01/v2-test.pdf");
  // The grant/token layer is product+order scoped — a version publish
  // changes WHERE the bytes come from, never WHETHER the token verifies.
  assert.equal(verifyDownloadToken(tokenBefore).ok, true);
  const tokenAfter = createDownloadToken("p01", "AST-TEST-1");
  assert.equal(verifyDownloadToken(tokenAfter).ok, true);
  const versions = await listVersions("p01");
  assert.ok(versions.some((v) => v.version === "2.0.0"));
});

test("version math: versionAt picks the release live at purchase time; isNewerVersion flags updates", () => {
  const records = [
    { productId: "p01", version: "1.0.0", fileKey: "k1", notes: null, createdAt: "2026-01-01T00:00:00.000Z" },
    { productId: "p01", version: "1.2.0", fileKey: "k2", notes: null, createdAt: "2026-06-01T00:00:00.000Z" },
  ];
  assert.equal(versionAt(records, "2026-03-01T00:00:00.000Z"), "1.0.0");
  assert.equal(versionAt(records, "2026-07-01T00:00:00.000Z"), "1.2.0");
  assert.equal(versionAt(records, "2025-01-01T00:00:00.000Z"), "1.0.0"); // base before any record
  assert.equal(isNewerVersion("1.2.0", "1.0.0"), true);
  assert.equal(isNewerVersion("1.0.0", "1.2.0"), false);
  assert.equal(isNewerVersion("2.0.0", "1.9.9"), true);
});

test("library lists only the orders it is given (ownership is the caller's query)", () => {
  const aliceOrders = [{ orderId: "A1", createdAt: "2026-02-01T00:00:00.000Z", status: "paid", productIds: ["p01", "p02"] }];
  const bobOrders = [{ orderId: "B1", createdAt: "2026-02-01T00:00:00.000Z", status: "paid", productIds: ["p03"] }];
  const aliceEntries = buildLibraryEntries(aliceOrders, new Map());
  assert.equal(aliceEntries.length, 2);
  assert.ok(aliceEntries.every((e) => e.orderId === "A1"));
  assert.ok(!aliceEntries.some((e) => e.product.id === "p03"));
  const bobEntries = buildLibraryEntries(bobOrders, new Map());
  assert.deepEqual(bobEntries.map((e) => e.product.id), ["p03"]);
  // Unpaid orders never enter the library; tokens verify against the product.
  const unpaid = buildLibraryEntries([{ orderId: "X", createdAt: "2026-02-01T00:00:00.000Z", status: "pending", productIds: ["p01"] }], new Map());
  assert.equal(unpaid.length, 0);
  const token = aliceEntries[0].downloadUrl.split("/").pop();
  const v = verifyDownloadToken(token);
  assert.equal(v.ok, true);
  assert.equal(v.payload.pid, aliceEntries[0].product.id);
});

test("library marks entries updated when a newer version exists than at purchase", () => {
  const orders = [{ orderId: "A2", createdAt: "2026-02-01T00:00:00.000Z", status: "paid", productIds: ["p01"] }];
  const versions = new Map([["p01", [{ productId: "p01", version: "1.5.0", fileKey: "k", createdAt: "2026-05-01T00:00:00.000Z" }]]]);
  const [entry] = buildLibraryEntries(orders, versions);
  assert.equal(entry.purchasedVersion, "1.0.0");
  assert.equal(entry.latestVersion, "1.5.0");
  assert.equal(entry.updated, true);
});

test("local order records flatten bundle contents into library inputs", () => {
  const inputs = localOrdersToInputs([
    {
      orderId: "L1", createdAt: "2026-02-01T00:00:00.000Z", status: "paid",
      items: [
        { id: "p01", productIds: undefined },
        { id: "b1", productIds: ["p02", "p03"] },
        { id: "nope", productIds: undefined },
      ],
    },
  ]);
  assert.deepEqual(inputs[0].productIds, ["p01", "p02", "p03"]);
});

test("preview size cap: over-cap and unknown sizes rejected, default is 25MB", () => {
  assert.equal(previewMaxBytes({}), 25 * 1024 * 1024);
  assert.equal(previewMaxBytes({ PREVIEW_MAX_MB: "5" }), 5 * 1024 * 1024);
  const max = previewMaxBytes({});
  assert.equal(previewSizeAllowed(10 * 1024 * 1024, max), true);
  assert.equal(previewSizeAllowed(30 * 1024 * 1024, max), false);
  assert.equal(previewSizeAllowed(null, max), false);
  assert.equal(previewSizeAllowed(undefined, max), false);
});

test("preview fallback document: formatted, escaped, honest about its source", () => {
  const fake = { ...getProductById("p01"), title: "<script>alert(1)</script>" };
  const doc = buildPreviewFallbackDoc(fake);
  assert.ok(doc.includes("&lt;script&gt;"));
  assert.ok(!doc.includes("<script>alert"));
  assert.ok(doc.includes("free preview"));
  assert.ok(doc.includes("storage is not configured"));
  assert.ok(doc.includes(PRODUCTS[0].preview.slice(0, 24)));
});

test("audio detection: audio-format products get the player treatment", () => {
  assert.equal(isAudioProduct(getProductById("p03")), true); // lo-fi music (MP3/FLAC)
  assert.equal(isAudioProduct(getProductById("p01")), false); // ebook
});
