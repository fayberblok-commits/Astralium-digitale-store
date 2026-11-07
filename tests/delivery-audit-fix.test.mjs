import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "node:module";

// Route handlers and lib/fulfill use Next-style extensionless imports
// (and "next/server"), which plain Node cannot resolve. This loader
// hook maps them so the REAL download route and success-page link
// builder run in this suite — no production code is altered for it.
const nextServerUrl = pathToFileURL(join(process.cwd(), "node_modules", "next", "server.js")).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
      if (specifier === "next/server") return { url: ${JSON.stringify(nextServerUrl)}, shortCircuit: true };
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\\.(ts|tsx|js|mjs|json)$/.test(specifier)) {
        try { return await next(specifier + ".ts", context); } catch {}
        try { return await next(specifier + ".tsx", context); } catch {}
      }
      return next(specifier, context);
    }`),
);

/**
 * Delivery-audit fix regressions (findings 71–74, 2026-11-07):
 *  71 — the buyer Library minted real download tokens from fabricated
 *       client order records; the download route honoured grant-less
 *       tokens for ledger orders.
 *  72 — the Library's DB mode unlocked a buyer's whole library from
 *       an email address alone.
 *  73 — with storage configured, a missing binding still served the
 *       generated "LICENSED DELIVERABLE" placeholder to paying buyers.
 *  74 — success-page tokens bypassed the grant layer (no cap, no
 *       revocation on refund).
 * File-store mode (no DATABASE_URL), self-scrubbing like the drills.
 */
delete process.env.DATABASE_URL;
delete process.env.S3_BUCKET;
delete process.env.S3_ACCESS_KEY_ID;
delete process.env.S3_SECRET_ACCESS_KEY;
process.env.DOWNLOAD_SIGNING_SECRET = ["delfix", "test", "signing", "secret", "0123456789abcdef0123456789"].join("-");

const orders = await import("../src/lib/orders.ts");
const { buildLibraryEntries, verifiedLibraryOrders, ledgerOrderToLibraryInput } = await import("../src/lib/library.ts");
const { downloadLinksFor } = await import("../src/lib/fulfill.ts");
const { createDownloadToken } = await import("../src/lib/tokens.ts");
const { GET: downloadGET } = await import("../src/app/api/download/[token]/route.ts");

const EMAIL = "buyer-delfix@example.com";
const ORDER1 = { orderId: "AST-DELFIX-1", provider: "paypal", providerRef: "PAYPAL-DELFIX-1", email: EMAIL, currency: "USD", totalUSD: 29, items: [{ productId: "p03", priceUSD: 29 }] };
const ORDER2 = { orderId: "AST-DELFIX-2", provider: "paypal", providerRef: "PAYPAL-DELFIX-2", email: EMAIL, currency: "USD", totalUSD: 29, items: [{ productId: "p03", priceUSD: 29 }] };
let grantToken1 = "";
let grantToken2 = "";

before(async () => {
  await orders.createPendingOrder(ORDER1);
  const paid1 = await orders.markPaidAndGrant(ORDER1);
  assert.equal(paid1.ok, true);
  grantToken1 = paid1.grants[0].token;
  await orders.createPendingOrder(ORDER2);
  const paid2 = await orders.markPaidAndGrant(ORDER2);
  assert.equal(paid2.ok, true);
  grantToken2 = paid2.grants[0].token;
});

after(() => {
  const path = join(process.cwd(), ".data", "orders.json");
  if (!existsSync(path)) return;
  const store = JSON.parse(readFileSync(path, "utf8"));
  const mine = new Set([ORDER1.orderId, ORDER2.orderId]);
  if (Array.isArray(store.orders)) store.orders = store.orders.filter((o) => !mine.has(o.id));
  if (Array.isArray(store.grants)) store.grants = store.grants.filter((g) => !mine.has(g.orderId));
  writeFileSync(path, JSON.stringify(store, null, 2));
});

async function callDownload(token) {
  return downloadGET({}, { params: Promise.resolve({ token }) });
}

test("71: a fabricated library record mints NOTHING — no orders, no tokens", async () => {
  const fake = await verifiedLibraryOrders({
    email: "victim@example.com",
    records: [{ providerRef: "FAKE-REF-999", orderId: "AST-AUDITFAKE1", status: "paid", items: [{ id: "p03" }] }],
  });
  assert.equal(fake.orders.length, 0);
  assert.equal(fake.tokens.size, 0);
  // A record with only the enumerable store order id (no providerRef
  // capability) admits nothing either.
  const noRef = await verifiedLibraryOrders({ records: [{ orderId: ORDER1.orderId, status: "paid", items: [{ id: "p03" }] }] });
  assert.equal(noRef.orders.length, 0);
  assert.equal(noRef.tokens.size, 0);
});

test("72: an email address alone unlocks NOTHING, even when the ledger holds that buyer's paid order", async () => {
  const byEmail = await verifiedLibraryOrders({ email: EMAIL, records: [] });
  assert.equal(byEmail.orders.length, 0);
  assert.equal(byEmail.tokens.size, 0);
  const noInput = await verifiedLibraryOrders({});
  assert.equal(noInput.orders.length, 0);
});

test("71: the real providerRef admits the LEDGER order — its items and its GRANT token, claims ignored", async () => {
  const verified = await verifiedLibraryOrders({
    email: EMAIL,
    // The record lies about everything except the capability: status
    // and items must come from the ledger, never from this claim.
    records: [{ providerRef: ORDER1.providerRef, status: "initiated", items: [{ id: "p01" }] }],
  });
  assert.equal(verified.orders.length, 1);
  assert.equal(verified.orders[0].id, ORDER1.orderId);
  assert.equal(verified.orders[0].status, "paid");
  // The handed-out token IS the fulfilment grant token (re-derived),
  // and the claimed p01 earns no token at all.
  assert.equal(verified.tokens.get(`${ORDER1.orderId}:p03`), grantToken1);
  assert.equal(verified.tokens.has(`${ORDER1.orderId}:p01`), false);
  // The route's composition: exactly one entry, carrying the grant URL.
  const entries = buildLibraryEntries(
    [ledgerOrderToLibraryInput(verified.orders[0])],
    new Map(),
    (pid, oid) => verified.tokens.get(`${oid}:${pid}`) ?? null,
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].product.id, "p03");
  assert.equal(entries[0].downloadUrl, `/api/download/${grantToken1}`);
});

test("71: the builder itself refuses unpaid statuses and token-less entries", () => {
  const initiated = buildLibraryEntries(
    [{ orderId: "X", createdAt: "2026-02-01T00:00:00.000Z", status: "initiated", productIds: ["p03"] }],
    new Map(),
  );
  assert.equal(initiated.length, 0);
  const tokenless = buildLibraryEntries(
    [{ orderId: "X", createdAt: "2026-02-01T00:00:00.000Z", status: "paid", productIds: ["p03"] }],
    new Map(),
    () => null,
  );
  assert.equal(tokenless.length, 0);
});

test("74: success-page links ARE the grant tokens — stable across views, grant-backed", async () => {
  const verifiedOrder = { orderId: ORDER1.orderId, email: EMAIL, productIds: ["p03"], provider: "paypal" };
  const links = await downloadLinksFor(verifiedOrder);
  assert.equal(links.length, 1);
  const token = links[0].url.split("/").pop();
  assert.equal(token, grantToken1);
  const grant = await orders.getGrantByToken(token);
  assert.ok(grant && !grant.revokedAt);
  // A second page view re-derives the SAME grant token — no fresh
  // ungoverned token is minted per view.
  const again = await downloadLinksFor(verifiedOrder);
  assert.equal(again[0].url, links[0].url);
  // grantTokenFor reconstruction is exact for grants issued at fulfilment.
  assert.equal(orders.grantTokenFor(grant), grantToken1);
  // grantTokensForOrder returns the same governed set.
  const order = await orders.getOrderById(ORDER1.orderId);
  const map = await orders.grantTokensForOrder(order);
  assert.equal(map.get("p03"), grantToken1);
});

test("71: the download route refuses a grant-less token that names a ledger order", async () => {
  const stateless = createDownloadToken("p03", ORDER2.orderId);
  const res = await callDownload(stateless);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "GRANT_REQUIRED");
});

test("71/74: the grant token itself still serves; a pre-ledger token keeps its documented semantics", async () => {
  // No storage configured in this suite → the local pipeline-proof
  // deliverable is the serve; what matters is the grant token passes
  // every gate and the count is consumed exactly once.
  const beforeCount = (await orders.listGrantsForOrder(ORDER2.orderId))[0].downloadsCount;
  const res = await callDownload(grantToken2);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /LICENSED DELIVERABLE/);
  const afterCount = (await orders.listGrantsForOrder(ORDER2.orderId))[0].downloadsCount;
  assert.equal(afterCount, beforeCount + 1);
  // A token naming an order the ledger has never seen (pre-ledger
  // link) keeps signature+expiry semantics — it is not stranded.
  const legacy = createDownloadToken("p03", "AST-PRELEDGER-9");
  const legacyRes = await callDownload(legacy);
  assert.equal(legacyRes.status, 200);
});

test("73: storage configured + binding missing → loud 502, never the placeholder, grant NOT consumed", async () => {
  process.env.S3_BUCKET = "delfix-test-bucket";
  process.env.S3_ACCESS_KEY_ID = "delfix-test-key";
  process.env.S3_SECRET_ACCESS_KEY = "delfix-test-secret";
  try {
    const beforeCount = (await orders.listGrantsForOrder(ORDER2.orderId))[0].downloadsCount;
    const res = await callDownload(grantToken2);
    assert.equal(res.status, 502);
    const body = await res.text();
    assert.ok(!body.includes("LICENSED DELIVERABLE"));
    assert.equal(JSON.parse(body).error, "DELIVERY_TEMPORARILY_UNAVAILABLE");
    const afterCount = (await orders.listGrantsForOrder(ORDER2.orderId))[0].downloadsCount;
    assert.equal(afterCount, beforeCount);
  } finally {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
  }
});

test("74: a refund kills the success-page links and the previously issued grant token", async () => {
  const refund = await orders.applyRefund(ORDER1.providerRef);
  assert.equal(refund.ok, true);
  // The success page's link builder now issues nothing for the order.
  const links = await downloadLinksFor( {
    orderId: ORDER1.orderId, email: EMAIL, productIds: ["p03"], provider: "paypal",
  });
  assert.equal(links.length, 0);
  // And the token the buyer saved earlier is refused as revoked.
  const res = await callDownload(grantToken1);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "GRANT_REVOKED");
});
