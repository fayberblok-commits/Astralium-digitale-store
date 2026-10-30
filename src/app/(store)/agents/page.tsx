import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AgentChat } from "@/components/ai-chat";
import { getLocaleContext } from "@/lib/locale";
import { CURRENCIES } from "@/lib/money";
import { getAgents, getProductBySlug } from "@/lib/store";

export const metadata: Metadata = {
  title: "الموظفون الاصطناعيون للعملاء",
  description: "فريق من الموظفين الاصطناعيين: استقبال، مستشار مبيعات، دعم، ومتابعة ما بعد الشراء — يجيبون بلغتك ويقترحون الأنسب.",
};

type SearchParams = Promise<{ agent?: string; product?: string }>;

export default async function AgentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getLocaleContext();
  const agents = await getAgents("customer");
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";
  const product = params.product ? await getProductBySlug(params.product) : null;
  const prefill = product
    ? locale === "ar"
      ? `أريد معرفة المزيد عن «${product.title}» وهل يناسب هدفي. ميزانيتي قريبة من ${(product.priceCents / 100).toFixed(0)} دولار.`
      : `I would like to know more about “${product.titleEn || product.title}” and whether it fits my goal. My budget is around $${(product.priceCents / 100).toFixed(0)}.`
    : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-8 max-w-3xl">
        <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("nav_agents")}</p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-[#f8f3e6] sm:text-4xl">{t("agents_title")}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#b1acc0]">{t("agents_subtitle")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="chip">{locale === "ar" ? "يجيب بلغة العميل" : "Replies in your language"}</span>
          <span className="chip">{locale === "ar" ? "أسئلة قصيرة وذكية" : "Short, smart questions"}</span>
          <span className="chip">{locale === "ar" ? "لا يخترع معلومات" : "Never invents facts"}</span>
          <span className="chip">{locale === "ar" ? "تحويل للدعم عند الحاجة" : "Escalates to support"}</span>
        </div>
      </div>

      {product ? (
        <div className="glass mb-5 rounded-xl px-4 py-3 text-[12.5px] text-[#d8cbaa]">
          {locale === "ar" ? "سياق المنتج: " : "Product context: "}
          <Link href={`/product/${product.slug}`} className="underline decoration-[rgba(217,178,106,0.5)] underline-offset-2">
            {locale === "ar" ? product.title : product.titleEn || product.title}
          </Link>
        </div>
      ) : null}

      <AgentChat
        agents={agents.map((agent) => ({
          slug: agent.slug,
          name: agent.name,
          title: agent.title,
          specialty: agent.specialty,
          glyph: agent.glyph,
          greeting: agent.greeting,
          greetingEn: agent.greetingEn,
        }))}
        locale={locale}
        currency={currency}
        initialAgent={params.agent}
        prefill={prefill}
      />

      <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {agents.map((agent) => (
          <div key={agent.id} className="glass rounded-2xl p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(217,178,106,0.35)] bg-[rgba(217,178,106,0.1)]" aria-hidden="true">
              {agent.glyph}
            </span>
            <h2 className="mt-3 font-display text-lg text-[#f4efe3]">{agent.name}</h2>
            <p className="text-[10.5px] uppercase tracking-[0.18em] text-[#bfae88]">{agent.title}</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#a8a4b8]">{agent.specialty}</p>
            <p className="mt-3 text-[11px] text-[#807c91]">
              {locale === "ar" ? "لغات:" : "Languages:"} {agent.languages.join(" · ")}
            </p>
          </div>
        ))}
      </section>

      <section className="glass mt-8 rounded-2xl p-5">
        <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "كيف نحمي محادثتك؟" : "How we protect your conversation"}</h2>
        <ul className="mt-3 grid gap-2 text-[12.5px] leading-relaxed text-[#a9a4b8] sm:grid-cols-2">
          <li>
            {locale === "ar"
              ? "• لا يطلب الموظف أي بيانات بنكية أو كلمات مرور، ولا يعرض تفاصيل داخلية عن المتجر."
              : "• Agents never request banking data or passwords, and never expose internal store details."}
          </li>
          <li>
            {locale === "ar"
              ? "• الاقتراحات مبنية على كتالوج المتجر الفعلي فقط، بلا أسعار أو وعود مُختلقة."
              : "• Recommendations come only from the live catalogue — no invented prices or promises."}
          </li>
          <li>
            {locale === "ar" ? "• يمكنك طلب التحويل إلى الدعم البشري في أي لحظة." : "• You can request a human support hand-off at any moment."}
          </li>
          <li>
            {locale === "ar" ? "• تُحفظ المحادثة لأغراض تحسين الجودة فقط." : "• Transcripts are stored for quality improvement only."}
          </li>
        </ul>
      </section>
    </div>
  );
}
