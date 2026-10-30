import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p6-support-")));
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

const tools = await import("../src/lib/support-tools.ts");
const { createGroundedEngine } = await import("../src/services/ai-support-v2.ts");
const { PRODUCTS } = await import("../src/data/products.ts");

const ORDER = {
  id: "ord-123",
  email: "Buyer@Example.com",
  status: "fulfilled",
  totalUSD: 49,
  currency: "USD",
  createdAt: "2026-10-01T10:00:00.000Z",
  items: [{ productId: "ai-profit-blueprint", title: "The AI Profit Blueprint" }],
  delivery: [{ channel: "email", status: "delivered" }],
  downloadGrants: 1,
};
const fetcher = async (id) => (id === ORDER.id ? ORDER : null);

test("order lookup: matching id + email returns status/delivery state only — never links", async () => {
  const r = await tools.orderLookup("ord-123", "buyer@example.com", fetcher);
  assert.equal(r.found, true);
  assert.equal(r.order.status, "fulfilled");
  assert.equal(r.order.delivery[0].channel, "email");
  const answer = tools.composeOrderAnswer(r);
  assert.match(answer, /fulfilled/);
  assert.ok(!/https?:\/\//.test(answer), "answer must contain no URLs");
  assert.ok(!answer.includes("/api/download"), "answer must contain no download paths");
  assert.ok(!JSON.stringify(r).includes("token"), "result must carry no token material");
});

test("order lookup: email mismatch is indistinguishable from a nonexistent order", async () => {
  const wrongEmail = await tools.orderLookup("ord-123", "someone-else@example.com", fetcher);
  const unknownId = await tools.orderLookup("ord-999", "buyer@example.com", fetcher);
  assert.deepEqual(wrongEmail, { found: false });
  assert.deepEqual(unknownId, { found: false });
  // Same generic customer-facing text either way.
  assert.equal(tools.composeOrderAnswer(wrongEmail), tools.composeOrderAnswer(unknownId));
});

test("order lookup: malformed inputs are refused without calling the fetcher", async () => {
  let calls = 0;
  const counting = async () => { calls++; return ORDER; };
  assert.deepEqual(await tools.orderLookup("", "buyer@example.com", counting), { found: false });
  assert.deepEqual(await tools.orderLookup("ord-123", "not-an-email", counting), { found: false });
  assert.equal(calls, 0);
});

test("order intent: id + email are extracted from free text (en + ar)", () => {
  const en = tools.detectOrderIntent("Where is my order ord-123? My email is buyer@example.com");
  assert.equal(en.orderId, "ord-123");
  assert.equal(en.email, "buyer@example.com");
  const ar = tools.detectOrderIntent("ما هي حالة طلبي؟");
  assert.ok(ar !== null && ar.orderId === null, "arabic order question is an intent without id");
  assert.equal(tools.detectOrderIntent("Do you have any courses on Python?"), null);
});

test("product tools answer from the real catalog only", () => {
  const p = PRODUCTS[0];
  const details = tools.productDetails(p.slug);
  assert.equal(details.title, p.title);
  assert.equal(details.priceUSD, p.priceUSD);
  assert.equal(tools.productDetails("no-such-product"), null);
  const found = tools.productSearch("AI Profit Blueprint");
  assert.ok(found.some((x) => x.slug === p.slug));
});

test("chunkText: chunks reassemble exactly and respect the size budget", () => {
  const samples = [
    "Hello world, this is a longer answer with several sentences. It streams progressively!",
    "short",
    "",
    "word ".repeat(100).trim(),
    "Supercalifragilisticexpialidocious is one very long word that must still reassemble exactly.",
  ];
  for (const s of samples) {
    const chunks = tools.chunkText(s, 24);
    assert.equal(chunks.join(""), s);
    for (const c of chunks) assert.ok(c.length <= 48, `chunk too long: ${c.length}`);
  }
  assert.deepEqual(tools.chunkText(""), []);
});

test("streaming engine: order question streams the composed tool answer", async () => {
  const engine = createGroundedEngine({ fetchOrder: fetcher });
  const gen = engine.stream("What is the status of my order?", { orderId: "ord-123", email: "buyer@example.com" });
  let streamed = "";
  let step = await gen.next();
  while (!step.done) {
    streamed += step.value;
    step = await gen.next();
  }
  const final = step.value;
  assert.equal(streamed, final.answer);
  assert.match(streamed, /fulfilled/);
  assert.equal(final.model, "grounded-tools");
  assert.deepEqual(final.sources, ["order:ord-123"]);
});

test("streaming engine: failed lookup is the generic not-found, flagged for handoff", async () => {
  const engine = createGroundedEngine({ fetchOrder: fetcher });
  const answer = await engine.answer("order status please", { orderId: "ord-123", email: "wrong@example.com" });
  assert.equal(answer.handoff, true);
  assert.match(answer.answer, /could not find/i);
  assert.ok(!answer.answer.includes("ord-123"), "answer must not echo the attempted id as if it existed");
});

test("engine: order question without id/email asks for both instead of guessing", async () => {
  const engine = createGroundedEngine({ fetchOrder: fetcher });
  const answer = await engine.answer("Where is my order?");
  assert.match(answer.answer, /order ID/i);
  assert.equal(answer.handoff, false);
});

test("engine: catalog question uses the grounded catalog path", async () => {
  const engine = createGroundedEngine({ fetchOrder: fetcher });
  const answer = await engine.answer("Tell me about The AI Profit Blueprint");
  assert.equal(answer.model, "local-data");
  assert.ok(answer.sources.includes(PRODUCTS[0].slug));
});
