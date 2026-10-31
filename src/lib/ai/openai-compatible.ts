/**
 * OpenAI-compatible Chat Completions provider (Phase 5 upgrade).
 *
 * One implementation serves BOTH the Meta Model API (primary —
 * https://api.meta.ai/v1, Bearer MODEL_API_KEY, model muse-spark-1.3)
 * and the generic fallback provider, because Meta's verified contract
 * is the OpenAI Chat Completions shape:
 *   POST {base}/chat/completions { model, messages, tools,
 *     tool_choice: "auto", stream } → choices[0].message / SSE deltas.
 *
 * Verified against Meta's official documentation (dev.meta.ai) as
 * corroborated by independent implementers (promptfoo, LiteLLM):
 *  - tool_choice accepts ONLY "auto" on the Meta API → we never send
 *    anything else, on either provider (auto is valid everywhere).
 *  - max_completion_tokens is the canonical output cap on the chat
 *    endpoint (max_tokens is a deprecated alias) → we send the former.
 *  - Muse Spark emits a NON-STANDARD SSE event that trips strict
 *    OpenAI clients → the stream parser below ignores unknown event
 *    types and non-JSON payloads instead of failing the turn.
 *  - No `stop`, `logprobs`, `logit_bias`, `n > 1` → never sent.
 *
 * The fetch implementation is injectable so the whole contract is
 * unit-testable offline.
 */
import {
  AiProviderError,
  type AiChatRequest,
  type AiCompletion,
  type AiMessage,
  type AiProvider,
  type AiToolCall,
} from "./types.ts";

export type FetchImpl = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  body: AsyncIterable<Uint8Array> | null;
}>;

const defaultFetch: FetchImpl = (url, init) =>
  fetch(url, init as RequestInit) as unknown as ReturnType<FetchImpl>;

export interface OpenAiCompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: FetchImpl;
}

interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toWireMessages(messages: AiMessage[]): WireMessage[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function buildBody(req: AiChatRequest, model: string, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(req.messages),
  };
  if (req.maxTokens !== undefined) body.max_completion_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    // Meta accepts ONLY "auto" (verified); it is also the OpenAI default.
    body.tool_choice = "auto";
  }
  if (stream) body.stream = true;
  return body;
}

interface WireToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

function parseToolCalls(raw: WireToolCall[] | undefined): AiToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c, i) => {
    let args: Record<string, unknown> = {};
    let malformed = false;
    try {
      const parsed = JSON.parse(c.function?.arguments ?? "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      } else {
        malformed = true;
      }
    } catch {
      malformed = true;
    }
    return { id: c.id ?? `call-${i}`, name: c.function?.name ?? "", arguments: args, ...(malformed ? { argumentsMalformed: true } : {}) };
  });
}

interface WireCompletion {
  choices?: {
    message?: { content?: string | null; tool_calls?: WireToolCall[] };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): AiProvider {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const endpoint = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function rawRequest(body: Record<string, unknown>) {
    let res: Awaited<ReturnType<FetchImpl>>;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AiProviderError(opts.id, 0, `network error: ${err instanceof Error ? err.message : "fetch failed"}`);
    }
    return res;
  }

  async function complete(req: AiChatRequest): Promise<AiCompletion> {
    const res = await rawRequest(buildBody(req, opts.model, false));
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AiProviderError(opts.id, res.status, `provider HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as WireCompletion;
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      toolCalls: parseToolCalls(choice?.message?.tool_calls),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      model: data.model ?? opts.model,
      finishReason: choice?.finish_reason ?? "stop",
    };
  }

  async function* stream(req: AiChatRequest): AsyncGenerator<string, AiCompletion, undefined> {
    const res = await rawRequest(buildBody(req, opts.model, true));
    if (!res.ok || !res.body) {
      const detail = res.body ? "" : await res.text().catch(() => "");
      throw new AiProviderError(opts.id, res.status, `provider HTTP ${res.status} (stream): ${detail.slice(0, 300)}`);
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let model = opts.model;
    let finishReason = "stop";
    let usage = { inputTokens: 0, outputTokens: 0 };
    // Tool-call deltas accumulate by index (OpenAI wire shape; Meta
    // streams arguments the same way per its docs).
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();

    const handlePayload = function* (payload: string): Generator<string> {
      if (payload === "[DONE]") return;
      let evt: {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
        type?: string;
      };
      try {
        evt = JSON.parse(payload) as typeof evt;
      } catch {
        return; // non-JSON payload — ignore (tolerant by design)
      }
      // Unknown event types (Meta's documented non-standard SSE event)
      // carry no choices — ignored here by construction.
      if (evt.model) model = evt.model;
      if (evt.usage) {
        usage = {
          inputTokens: evt.usage.prompt_tokens ?? usage.inputTokens,
          outputTokens: evt.usage.completion_tokens ?? usage.outputTokens,
        };
      }
      const choice = evt.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (!delta) return;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        text += delta.content;
        yield delta.content;
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) ?? { id: tc.id ?? `call-${idx}`, name: "", args: "" };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.args += tc.function.arguments;
        toolAcc.set(idx, acc);
      }
    };

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            yield* handlePayload(trimmed.slice(5).trim());
          }
          // event:/id:/retry lines and unknown frames are ignored.
        }
        sep = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim().startsWith("data:")) {
      yield* handlePayload(buffer.trim().slice(5).trim());
    }
    const toolCalls: AiToolCall[] = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, acc]) => {
        let args: Record<string, unknown> = {};
        let malformed = false;
        try {
          const parsed = JSON.parse(acc.args || "{}") as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
          else malformed = true;
        } catch {
          malformed = true;
        }
        return { id: acc.id, name: acc.name, arguments: args, ...(malformed ? { argumentsMalformed: true } : {}) };
      });
    return { text, toolCalls, usage, model, finishReason };
  }

  return { id: opts.id, model: opts.model, complete, stream };
}
