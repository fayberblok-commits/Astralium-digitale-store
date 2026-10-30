/**
 * AI support assistant v2 (Phase 6, feature 25). Flag `ai_support_v2`.
 *
 * Engine architecture: a SupportEngine produces a grounded
 * SupportAnswer; streaming is layered on top by chunking the final
 * answer progressively (chunkText). A future LLM engine can implement
 * the same two methods with token-level streaming without touching
 * the SSE route or the widget.
 *
 * The default (and only) engine is the grounded one:
 *  1. If the caller supplies an order id + email (widget form fields or
 *     detected in the message), the orderLookup TOOL runs and the
 *     answer is composed from its result — status/delivery state only,
 *     never links, never invented data; failures are the generic
 *     not-found message.
 *  2. Otherwise the Phase-1/2 grounded path answers (answerSupport):
 *     with OPENAI_API_KEY set, an OpenAI-compatible chat call with the
 *     catalog+policies injected as context; without it, the local
 *     deterministic catalog/policy engine. Either way the context is
 *     the real catalog — the model never sees other customers' data.
 */
import { answerSupport, type SupportAnswer } from "./ai-support.ts";
import {
  chunkText, composeOrderAnswer, detectOrderIntent, orderLookup, type OrderFetcher,
} from "../lib/support-tools.ts";

export interface SupportContext {
  orderId?: string | null;
  email?: string | null;
}

export interface SupportEngine {
  answer(question: string, ctx: SupportContext): Promise<SupportAnswer>;
  stream(question: string, ctx: SupportContext): AsyncGenerator<string, SupportAnswer, undefined>;
}

export function createGroundedEngine(deps: { fetchOrder?: OrderFetcher } = {}): SupportEngine {
  async function answer(question: string, ctx: SupportContext = {}): Promise<SupportAnswer> {
    const intent = detectOrderIntent(question);
    const orderId = ctx.orderId ?? intent?.orderId ?? null;
    const email = ctx.email ?? intent?.email ?? null;
    if (orderId && email) {
      const result = await orderLookup(orderId, email, deps.fetchOrder);
      return {
        answer: composeOrderAnswer(result),
        sources: result.found ? [`order:${result.order.orderId}`] : [],
        handoff: !result.found,
        model: "grounded-tools",
      };
    }
    if (intent && (intent.orderId || /order|طلب/i.test(question))) {
      // They are asking about an order but we lack id and/or email —
      // ask for both instead of guessing.
      return {
        answer:
          "I can check an order's status — please provide BOTH the order ID (from your receipt email) " +
          "and the email used at checkout. I never look up orders from a name alone.",
        sources: [],
        handoff: false,
        model: "grounded-tools",
      };
    }
    return answerSupport(question);
  }

  async function* stream(
    question: string,
    ctx: SupportContext = {},
  ): AsyncGenerator<string, SupportAnswer, undefined> {
    const final = await answer(question, ctx);
    for (const chunk of chunkText(final.answer)) {
      yield chunk;
    }
    return final;
  }

  return { answer, stream };
}

/** Default engine instance used by the routes. */
export const supportEngineV2: SupportEngine = createGroundedEngine();
