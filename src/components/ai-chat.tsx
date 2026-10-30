"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LocaleCode } from "@/lib/i18n";
import { convertFromUsd, formatAmount } from "@/lib/money";

export type ChatAgent = {
  slug: string;
  name: string;
  title: string;
  specialty: string;
  glyph: string;
  greeting: string;
  greetingEn: string | null;
};

type Message = { role: "user" | "assistant"; content: string };
type Recommendation = { slug: string; title: string; priceCents: number; category: string; coverGlyph: string };

export function AgentChat({
  agents,
  locale,
  currency,
  initialAgent,
  prefill,
  compact = false,
}: {
  agents: ChatAgent[];
  locale: LocaleCode;
  currency: string;
  initialAgent?: string;
  prefill?: string;
  compact?: boolean;
}) {
  const first = agents.find((agent) => agent.slug === initialAgent) ?? agents[0];
  const [activeSlug, setActiveSlug] = useState(first?.slug ?? "");
  const active = agents.find((agent) => agent.slug === activeSlug) ?? first;
  const greeting = active ? (locale === "ar" ? active.greeting : active.greetingEn || active.greeting) : "";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [quick, setQuick] = useState<string[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [escalated, setEscalated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentPrefill = useRef(false);

  useEffect(() => {
    setMessages([]);
    setRecommendations([]);
    setEscalated(false);
    setQuick(
      locale === "ar"
        ? ["أبحث عن كتاب لإدارة مشروع", "ميزانيتي 50 دولارًا", "كيف أستلم الملف بعد الدفع؟", "أحتاج دعمًا في طلبي"]
        : ["I need a project management book", "My budget is $50", "How do I get my file?", "I need order support"],
    );
  }, [activeSlug, locale]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || pending || !active) return;
    const nextMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: active.slug, messages: nextMessages.slice(-10), locale }),
      });
      const data = (await response.json()) as {
        reply?: string;
        quickReplies?: string[];
        recommendations?: Recommendation[];
        escalate?: boolean;
        error?: string;
      };
      if (!response.ok || !data.reply) {
        setError(data.error ?? (locale === "ar" ? "تعذّر الوصول إلى الموظف الآن، حاول مجددًا." : "The agent is unavailable now, please try again."));
      } else {
        setMessages([...nextMessages, { role: "assistant", content: data.reply }]);
        setQuick(data.quickReplies ?? []);
        setRecommendations(data.recommendations ?? []);
        setEscalated(Boolean(data.escalate));
      }
    } catch {
      setError(locale === "ar" ? "انقطع الاتصال. تحقّق من الشبكة وحاول مرة أخرى." : "Connection lost. Check your network and retry.");
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (prefill && active && !sentPrefill.current) {
      sentPrefill.current = true;
      void send(prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.slug, prefill]);

  if (!active) {
    return <div className="glass rounded-2xl p-6 text-sm text-[#a8a4b8]">{locale === "ar" ? "لا يوجد موظف متاح حاليًا." : "No agents available right now."}</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {compact ? null : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <button
              key={agent.slug}
              type="button"
              onClick={() => setActiveSlug(agent.slug)}
              className={`w-full rounded-xl border px-3 py-2.5 text-start transition ${
                agent.slug === active.slug
                  ? "border-[rgba(217,178,106,0.5)] bg-[rgba(217,178,106,0.12)]"
                  : "border-white/10 bg-white/[0.02] hover:border-[rgba(217,178,106,0.3)]"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(217,178,106,0.35)] text-sm" aria-hidden="true">
                  {agent.glyph}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-[#f2eddf]">{agent.name}</span>
                  <span className="block truncate text-[10.5px] text-[#a8a4b8]">{agent.title}</span>
                </span>
              </span>
            </button>
          ))}
          <p className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-[10.5px] leading-relaxed text-[#8f8ba2]">
            {locale === "ar"
              ? "موظفون اصطناعيون يعملون على كتالوج المتجر فقط، ويحوّلونك للدعم عند الحاجة. لا يشاركون معلومات المالك أو الأنظمة الداخلية."
              : "AI employees grounded in this catalogue only. They escalate to support when needed and never share owner or internal system data."}
          </p>
        </div>
      )}

      <div className="glass flex min-h-[440px] flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(217,178,106,0.4)] bg-[rgba(217,178,106,0.1)]" aria-hidden="true">
              {active.glyph}
            </span>
            <div>
              <p className="text-[13px] text-[#f4efe3]">{active.name}</p>
              <p className="text-[10.5px] text-[#9ed3b3]">
                <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {locale === "ar" ? "متصل الآن" : "Online now"} · {active.title}
              </p>
            </div>
          </div>
          <span className="chip">AI</span>
        </div>

        <div ref={scrollRef} className="max-h-[420px] min-h-[260px] flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="max-w-[92%] rounded-2xl rounded-ss-sm border border-[rgba(217,178,106,0.2)] bg-[rgba(217,178,106,0.07)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[#efe8d7]">
            {greeting}
          </div>
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
                message.role === "user"
                  ? "ms-auto rounded-se-sm bg-[#e9d3a1] text-[#171208]"
                  : "rounded-ss-sm border border-white/10 bg-white/[0.04] text-[#e9e4d8]"
              }`}
            >
              {message.content}
            </div>
          ))}
          {pending ? (
            <div className="max-w-[60%] rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[12px] text-[#a8a4b8]">
              {locale === "ar" ? "يكتب الآن…" : "Typing…"}
            </div>
          ) : null}
          {error ? <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">{error}</div> : null}
          {recommendations.length > 0 ? (
            <div className="space-y-2 rounded-2xl border border-[rgba(217,178,106,0.2)] bg-[rgba(217,178,106,0.04)] p-3">
              <p className="text-[10.5px] uppercase tracking-[0.2em] text-[#d9b26a]">{locale === "ar" ? "اقتراحات من الكتالوج" : "Catalogue suggestions"}</p>
              {recommendations.map((item) => (
                <Link
                  key={item.slug}
                  href={`/product/${item.slug}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#080a17]/70 px-3 py-2 text-[12px] text-[#efe9db] hover:border-[rgba(217,178,106,0.4)]"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span aria-hidden="true">{item.coverGlyph}</span>
                    <span className="truncate">{item.title}</span>
                  </span>
                  <span className="tabular whitespace-nowrap text-[#f0dcae]">{formatAmount(convertFromUsd(item.priceCents, currency), currency, locale)}</span>
                </Link>
              ))}
            </div>
          ) : null}
          {escalated ? (
            <Link href="/support" className="block rounded-xl border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] px-3 py-2 text-[12px] text-[#f0dcae]">
              {locale === "ar" ? "انتقل إلى مركز الدعم لإنشاء تذكرة متابعة ←" : "Go to the support centre to open a follow-up ticket ←"}
            </Link>
          ) : null}
        </div>

        {quick.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 border-t border-white/10 px-3 pb-0 pt-2.5">
            {quick.slice(0, 4).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => send(item)}
                disabled={pending}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-[#c9c4d4] hover:border-[rgba(217,178,106,0.4)] hover:text-[#f0dcae] disabled:opacity-50"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="flex items-center gap-2 border-t border-white/10 p-3"
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={locale === "ar" ? "اكتب سؤالك هنا…" : "Type your question…"}
            aria-label={locale === "ar" ? "رسالتك" : "Your message"}
            className="field text-[12.5px]"
            maxLength={800}
          />
          <button type="submit" disabled={pending || !input.trim()} className="btn-gold px-4 py-2 text-[12px] disabled:opacity-50">
            {locale === "ar" ? "أرسل" : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
