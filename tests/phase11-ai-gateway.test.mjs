/**
 * Phase 5 upgrade — AI gateway contract tests (offline, deterministic):
 *  - the OpenAI-compatible provider adapter against a FAKE fetch:
 *    Meta base URL + Bearer auth + tool_choice "auto" (the only value
 *    the Meta Model API accepts) + max_completion_tokens, tool-call
 *    parsing, and a TOLERANT SSE parser (Muse Spark emits a
 *    non-standard event that strict clients choke on);
 *  - provider resolution: no key → null (never a fake provider);
 *    Meta key → primary with the documented default model id;
 *  - usage ledger + published-rate cost math + cap evaluation;
 *  - employee overrides + deterministic routing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p11-gateway-")));
delete process.env.DATABASE_URL;
delete process.env.MODEL_API_KEY;
delete process.env.AI_FALLBACK_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.AI_PROVIDER;
process.env.AUTH_SECRET = "p11-gw-secret-01";

const providerMod = await import("../src/lib/ai/openai-compatible.ts");
const config = await import("../src/lib/ai/config.ts");
const usage = await import("../src/lib/ai/usage.ts");
const types = await import("../src/lib/ai/types.ts");
const employees = await import("../src/lib/ai/employees.ts");

// ─── 1. Provider wire contract (fake fetch) ──────────────────────────────────

test("provider: POSTs chat/completions with bearer auth, tool_choice auto, token cap", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    return {
      ok: true, status: 200, body: null,
      json: async () => ({
        model: "muse-spark-1.3",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant", content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "set_theme", arguments: "{\"palette\":\"tropical-glow\"}" } }],
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 25 },
      }),
      text: async () => "",
    };
  };
  const provider = providerMod.createOpenAiCompatibleProvider({
    id: "meta", baseUrl: "https://api.meta.ai/v1", apiKey: "test-key", model: "muse-spark-1.3", fetchImpl: fakeFetch,
  });
  const out = await provider.complete({
    messages: [{ role: "user", content: "switch theme" }],
    tools: [{ name: "set_theme", description: "d", parameters: { type: "object", properties: {} } }],
    maxTokens: 500,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://api.meta.ai/v1/chat/completions");
  assert.equal(seen[0].init.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, "muse-spark-1.3");
  assert.equal(body.tool_choice, "auto");
  assert.equal(body.max_completion_tokens, 500);
  assert.equal("stream" in body, false);
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, "set_theme");
  assert.deepEqual(out.toolCalls[0].arguments, { palette: "tropical-glow" });
  assert.equal(out.usage.inputTokens, 100);
  assert.equal(out.usage.outputTokens, 25);
});

test("provider: SSE stream tolerates non-standard Muse Spark events", async () => {
  // The non-standard event carries text that must NOT leak into the
  // answer — tolerance means "skip it", not "guess at it".
  const sse = [
    'data: {"type":"response.output_text.delta","delta":"MUST_NOT_APPEAR"}',
    'data: {"choices":[{"delta":{"content":"Hel"}}]}',
    'data: {"choices":[{"delta":{"content":"lo world"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({}), text: async () => "",
    body: (async function* () { yield new TextEncoder().encode(sse); })(),
  });
  const provider = providerMod.createOpenAiCompatibleProvider({
    id: "meta", baseUrl: "https://api.meta.ai/v1", apiKey: "k", model: "muse-spark-1.3", fetchImpl: fakeFetch,
  });
  let text = "";
  const gen = provider.stream({ messages: [{ role: "user", content: "hi" }] });
  let step = await gen.next();
  while (!step.done) { text += step.value; step = await gen.next(); }
  assert.equal(text, "Hello world");
  assert.equal(step.value.text, "Hello world");
  assert.equal(step.value.usage.inputTokens, 10);
});

test("provider: HTTP error surfaces as AiProviderError with status", async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, body: null, json: async () => ({}), text: async () => "nope" });
  const provider = providerMod.createOpenAiCompatibleProvider({
    id: "meta", baseUrl: "https://api.meta.ai/v1", apiKey: "bad", model: "muse-spark-1.3", fetchImpl: fakeFetch,
  });
  await assert.rejects(() => provider.complete({ messages: [{ role: "user", content: "hi" }] }), /401/);
});

// ─── 2. Provider resolution honesty ──────────────────────────────────────────

test("config: no keys → active provider is null and status says unconfigured", async () => {
  assert.equal(await config.buildProvider("meta"), null);
  assert.equal(await config.buildProvider("openai"), null);
  assert.equal(await config.resolveActiveProvider(), null);
  const status = await config.getAiStatus();
  assert.equal(status.configured, false);
  assert.equal(status.active, null);
});

test("config: Meta key → primary provider with documented default model id", async () => {
  process.env.MODEL_API_KEY = "test-meta-key";
  try {
    const provider = await config.buildProvider("meta");
    assert.ok(provider);
    assert.equal(provider.id, "meta");
    assert.equal(provider.model, "muse-spark-1.3");
    const status = await config.getAiStatus();
    assert.equal(status.configured, true);
    assert.equal(status.activeModel, "muse-spark-1.3");
    // Status must never contain key material.
    assert.equal(JSON.stringify(status).includes("test-meta-key"), false);
  } finally {
    delete process.env.MODEL_API_KEY;
  }
});

test("config: mock mode is explicit-only and reports itself as mock", async () => {
  process.env.AI_PROVIDER = "mock";
  try {
    const status = await config.getAiStatus();
    assert.equal(status.configured, true);
    assert.equal(status.active, "mock");
    assert.equal(status.mockMode, true);
    const provider = await config.resolveActiveProvider();
    assert.equal(provider.id, "mock");
  } finally {
    delete process.env.AI_PROVIDER;
  }
});

// ─── 3. Usage + caps ─────────────────────────────────────────────────────────

test("usage: published-rate cost math (Muse Spark $1.25/M in, $4.25/M out)", () => {
  const cost = types.estimateCostUSD("muse-spark-1.3", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(cost, 1.25 + 4.25);
  // The mock is deliberately priced at the Meta standard rate so the
  // daily cost cap is exercisable in offline tests.
  assert.equal(types.estimateCostUSD("mock-1", { inputTokens: 5000, outputTokens: 5000 }), 0.0275);
  // Unknown models fall back to the standard rate (never free).
  assert.equal(types.estimateCostUSD("some-future-model", { inputTokens: 1_000_000, outputTokens: 0 }), 1.25);
});

test("usage: ledger accumulates and caps evaluate against it", async () => {
  await usage.recordAiUsage({ usage: { inputTokens: 100_000, outputTokens: 0 }, model: "muse-spark-1.3", turn: true });
  await usage.recordAiUsage({ actions: 3, conversation: true });
  const today = await usage.getTodayUsage();
  assert.equal(today.costUSD, 0.125);
  assert.equal(today.actions, 3);
  assert.equal(today.turns, 1);
  assert.equal(today.conversations, 1);
  const capped = await usage.checkCaps({ dailyCostCapUSD: 0.1, dailyActionCap: 2 });
  assert.equal(capped.costOk, false);
  assert.equal(capped.actionsOk, false);
  const room = await usage.checkCaps({ dailyCostCapUSD: 5, dailyActionCap: 50 });
  assert.equal(room.costOk, true);
  assert.equal(room.actionsOk, true);
  // Cap of 0 means "no cap" (owner disabled the budget) — never a lockout.
  const noCap = await usage.checkCaps({ dailyCostCapUSD: 0, dailyActionCap: 0 });
  assert.equal(noCap.costOk, true);
  assert.equal(noCap.actionsOk, true);
});

// ─── 4. Employees: overrides + routing ───────────────────────────────────────

test("employees: owner overrides persist (disable → routing skips, restore works)", async () => {
  await employees.setEmployeeOverride("designer", { enabled: false });
  const all = await employees.getOwnerEmployees();
  assert.equal(all.find((e) => e.id === "designer").enabled, false);
  const routed = employees.routeOwnerEmployee("switch the theme please", all);
  assert.notEqual(routed, "designer");
  await employees.setEmployeeOverride("designer", { enabled: true, instructions: "Prefer gold accents." });
  const designer = await employees.getOwnerEmployee("designer");
  assert.equal(designer.enabled, true);
  assert.equal(designer.instructions, "Prefer gold accents.");
  assert.equal(employees.routeOwnerEmployee("switch the theme please", await employees.getOwnerEmployees()), "designer");
});

test("employees: customer routing is deterministic (orders context wins)", () => {
  assert.equal(employees.routeCustomerEmployee("where is my order?", true), "orders");
  assert.equal(employees.routeCustomerEmployee("my download is broken", false), "support");
  assert.equal(employees.routeCustomerEmployee("recommend a gift", false), "sales");
  assert.equal(employees.routeCustomerEmployee("hello there", false), "greeter");
});
