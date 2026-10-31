/**
 * AI gateway — provider-agnostic types (Phase 5 upgrade).
 *
 * The whole AI-staff architecture (customer team + owner employees)
 * talks to models ONLY through these types. A provider is any
 * OpenAI-compatible Chat Completions endpoint; the primary target is
 * the Meta Model API (Muse Spark), with a generic OpenAI-compatible
 * fallback and a deterministic mock for tests. No provider detail
 * (URLs, key names, payload quirks) leaks past the provider modules.
 */

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema (draft-07 subset) for the tool's arguments object. */
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  /** Parsed arguments ({} when the model sent unparseable JSON). */
  arguments: Record<string, unknown>;
  /** True when the arguments arrived as invalid JSON. */
  argumentsMalformed?: boolean;
}

export interface AiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Assistant messages that requested tools (replay format). */
  toolCalls?: AiToolCall[];
  /** Tool messages: the id of the call being answered. */
  toolCallId?: string;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiCompletion {
  text: string;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  model: string;
  finishReason: string;
}

export interface AiChatRequest {
  messages: AiMessage[];
  tools?: AiToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export interface AiProvider {
  /** "meta" | "openai-compatible" | "mock" */
  id: string;
  model: string;
  complete(req: AiChatRequest): Promise<AiCompletion>;
  /** Yields text deltas; the generator's return value is the final completion. */
  stream(req: AiChatRequest): AsyncGenerator<string, AiCompletion, undefined>;
}

export class AiProviderError extends Error {
  status: number;
  providerId: string;
  constructor(providerId: string, status: number, message: string) {
    super(message);
    this.name = "AiProviderError";
    this.providerId = providerId;
    this.status = status;
  }
}

/** Token-usage → USD estimate. Rates are the providers' PUBLISHED list
 * prices (Meta Model API standard tier, verified 2026-10-31); unknown
 * models fall back to the Meta standard rate. Estimates only — the
 * office UI labels them as such. */
const RATES_PER_M: Record<string, { input: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, output: 4.25 },
  "muse-spark-1.3-contributor": { input: 0.1, output: 0.2 },
  "muse-spark-1.1": { input: 1.25, output: 4.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "mock-1": { input: 1.25, output: 4.25 },
};

export function estimateCostUSD(model: string, usage: AiUsage): number {
  const rate = RATES_PER_M[model] ?? { input: 1.25, output: 4.25 };
  return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
}
