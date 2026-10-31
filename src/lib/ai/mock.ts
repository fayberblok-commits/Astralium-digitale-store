/**
 * Deterministic MOCK provider (Phase 5 upgrade) — tests & demos only.
 *
 * A scripted, offline stand-in for a real model. It "understands" a
 * small set of intent patterns in the owner's commands and in customer
 * questions, and emits the corresponding tool calls; once tool results
 * come back it produces a fixed summary sentence. It also has two
 * deliberate misbehaviour cues used by the security suites:
 *   - the word "refund" (or Arabic استرداد) in an OWNER turn makes it
 *     request the non-existent tool `issue_refund` — the tool layer
 *     must refuse it;
 *   - the token `__mock_toolcall__` in ANY turn makes it emit a tool
 *     call even when NO tools were offered (the customer path) — the
 *     customer engine must drop it.
 * Everything is deterministic: same input → same output, no network,
 * token usage derived from text length so cost caps are testable.
 *
 * Selection: only reachable when AI_PROVIDER=mock is set explicitly
 * (env validation warns loudly in production). Never a default.
 */
import type { AiChatRequest, AiCompletion, AiProvider, AiToolCall, AiUsage } from "./types.ts";

const PALETTE_WORDS: [RegExp, string][] = [
  [/tropical|استوائي/i, "tropical-glow"],
  [/aurora|شفق/i, "aurora-dawn"],
  [/cosmic|كوني/i, "cosmic-candy"],
  [/emerald|زمرد/i, "emerald-gold"],
  [/electric|كهربائي/i, "electric-blue"],
  [/classic|maison|كلاسيك/i, "maison-classic"],
];

function tokensOf(text: string): AiUsage {
  return {
    inputTokens: Math.max(1, Math.ceil(text.length / 4)),
    outputTokens: 24,
  };
}

function nextSundayISO(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const add = (7 - d.getUTCDay()) % 7 || 7; // strictly the coming Sunday
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export interface MockProvider extends AiProvider {
  requests: AiChatRequest[];
}

export function createMockProvider(): MockProvider {
  const requests: AiChatRequest[] = [];

  function decide(req: AiChatRequest): AiCompletion {
    requests.push(req);
    const allText = req.messages.map((m) => m.content).join("\n");
    const usage = tokensOf(allText);
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const toolResults = req.messages.filter((m) => m.role === "tool");
    const offered = new Set((req.tools ?? []).map((t) => t.name));
    const call = (name: string, args: Record<string, unknown>): AiToolCall => ({
      id: `mock-call-${requests.length}`,
      name,
      arguments: args,
    });
    const done = (text: string, toolCalls: AiToolCall[] = []): AiCompletion => ({
      text, toolCalls, usage, model: "mock-1", finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    });

    // Tool results are back → summarize deterministically.
    if (toolResults.length > 0) {
      const last = toolResults[toolResults.length - 1];
      return done(`Understood. The tool result was: ${last.content.slice(0, 400)}`);
    }

    // Deliberate misbehaviour cue (customer path / no tools offered).
    if (lastUser.includes("__mock_toolcall__") || allText.includes("__mock_toolcall__")) {
      return done("", [call("issue_refund", { orderId: "any", amountUSD: 1 })]);
    }

    if (offered.size > 0) {
      const t = lastUser;
      // Forbidden request — must be refused by the tool layer.
      if (/refund|استرداد|استرجاع/i.test(t) && offered.size > 0 && !/summary|report/i.test(t)) {
        if (/refund/i.test(t) || /استرداد/.test(t)) return done("", [call("issue_refund", { orderId: "last", amountUSD: 10 })]);
      }
      if (/bank|iban|حساب بنكي|بيانات البنك/i.test(t)) {
        return done("", [call("get_bank_details", {})]);
      }
      if (/delete|remove|احذف|حذف/i.test(t)) {
        return done("", [call("delete_product", { productId: "p01" })]);
      }
      const palette = PALETTE_WORDS.find(([re]) => re.test(t));
      if (palette && offered.has("set_theme")) {
        return done("", [call("set_theme", { palette: palette[1] })]);
      }
      if (/section|ترتيب الأقسام|أقسام/i.test(t) && offered.has("set_home_sections")) {
        const order = ["newsletter", "hero", "trust", "featured", "categories", "bundles", "new", "how", "guarantee", "testimonials", "faq"];
        return done("", [call("set_home_sections", { order, hidden: [] })]);
      }
      if (/banner|لافتة/i.test(t) && offered.has("set_banner")) {
        return done("", [call("set_banner", { enabled: true, textEn: "Weekend offer", textAr: "عرض نهاية الأسبوع", url: "" })]);
      }
      if (/(coupon|discount|خصم|كوبون)/i.test(t) && offered.has("create_coupon")) {
        const pct = Number(t.match(/(\d{1,2})\s*%/)?.[1] ?? 10);
        const code = (t.match(/code\s+([A-Za-z0-9]{3,20})/i)?.[1] ?? `STAFF${pct}`).toUpperCase();
        const args: Record<string, unknown> = { code, type: "percent", value: pct, active: true };
        if (/sunday|الأحد/i.test(t)) args.expiresAt = nextSundayISO();
        return done("", [call("create_coupon", args)]);
      }
      if (/(sales|revenue|summary|مبيعات|ملخص)/i.test(t) && offered.has("sales_summary")) {
        return done("", [call("sales_summary", { days: 7 })]);
      }
      if (/security|أمان|تنبيهات/i.test(t) && offered.has("security_summary")) {
        return done("", [call("security_summary", {})]);
      }
      if (/(price|سعر)/i.test(t) && offered.has("update_product_price")) {
        const price = Number(t.match(/\$?\s*(\d+(?:\.\d{1,2})?)/)?.[1] ?? 0);
        const slug = t.match(/([a-z0-9]+(?:-[a-z0-9]+)+)/)?.[1] ?? "ai-profit-blueprint";
        return done("", [call("update_product_price", { productSlug: slug, priceUSD: price })]);
      }
      if (/(publish|انشر|نشر)/i.test(t) && offered.has("publish_product")) {
        const slug = t.match(/([a-z0-9]+(?:-[a-z0-9]+)+)/)?.[1] ?? "ai-profit-blueprint";
        return done("", [call("publish_product", { productSlug: slug })]);
      }
      if (/(article|blog|مقال)/i.test(t) && offered.has("draft_blog_post")) {
        const title = t.match(/"([^"]{3,120})"/)?.[1] ?? "Why digital products win";
        return done("", [call("draft_blog_post", { title, body: `# ${title}\n\nA short draft written by the marketing employee.`, locale: "en" })]);
      }
      if (/(translate|ترجم)/i.test(t) && offered.has("translate_product")) {
        const slug = t.match(/([a-z0-9]+(?:-[a-z0-9]+)+)/)?.[1] ?? "ai-profit-blueprint";
        return done("", [call("translate_product", {
          productSlug: slug,
          locale: /spanish|español|إسباني/i.test(t) ? "es" : "fr",
          title: "El plan de ganancias con IA",
          subtitle: "10 servicios de IA que puedes vender esta semana",
          description: "Una guía práctica y directa para vender servicios de IA esta misma semana.",
        })]);
      }
      return done("I can help with design, marketing, numbers, translations, products and security summaries. Tell me what to do.");
    }

    // Customer path (no tools offered): grounded-style deterministic reply.
    if (/__handoff__/i.test(lastUser)) {
      return done("HANDOFF: I could not find that in the store's information.");
    }
    return done("Based on the store information provided, I can help with products, prices, delivery, refunds and order status. Everything I state comes from the catalog and policies in my context.");
  }

  async function complete(req: AiChatRequest): Promise<AiCompletion> {
    return decide(req);
  }

  async function* stream(req: AiChatRequest): AsyncGenerator<string, AiCompletion, undefined> {
    const final = decide(req);
    const words = final.text.split(/(?<=\s)/);
    for (const w of words) {
      if (w) yield w;
    }
    return final;
  }

  return { id: "mock", model: "mock-1", requests, complete, stream };
}
