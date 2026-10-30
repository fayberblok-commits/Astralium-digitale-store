import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AgentChat } from "@/components/ai-chat";
import { Alert } from "@/components/ui";
import { createSupportTicket } from "@/app/actions";
import { getLocaleContext } from "@/lib/locale";
import { CURRENCIES } from "@/lib/money";
import { getAgents, getFaqs } from "@/lib/store";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "مركز الدعم",
  description: "أسئلة شائعة، إنشاء تذاكر دعم، ودردشة مباشرة مع موظف اصطناعي للدعم في Astralium Digitale Store.",
};

type SearchParams = Promise<{ state?: string; ticket?: string }>;

export default async function SupportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getLocaleContext();
  const [faqs, agents, settings] = await Promise.all([getFaqs(), getAgents("customer"), getSettings()]);
  const supportAgents = agents.filter((agent) => agent.slug.includes("support") || agent.specialty.includes("دعم"));
  const chatAgents = (supportAgents.length ? supportAgents : agents).map((agent) => ({
    slug: agent.slug,
    name: agent.name,
    title: agent.title,
    specialty: agent.specialty,
    glyph: agent.glyph,
    greeting: agent.greeting,
    greetingEn: agent.greetingEn,
  }));
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-8 max-w-3xl">
        <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("nav_support")}</p>
        <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{t("support_title")}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[#b1acc0]">{t("support_subtitle")}</p>
      </div>

      {params.ticket ? (
        <div className="mb-6">
          <Alert tone="success">
            {locale === "ar" ? "تم إنشاء تذكرة الدعم بنجاح. رقم المتابعة: " : "Your support ticket was created. Reference: "}
            <span className="font-mono text-[#f7eccd]">{params.ticket}</span>
            {" — "}
            {locale === "ar" ? "احتفظ بالرقم، وسيتم الرد على بريدك خلال 24 ساعة عمل." : "keep this number; we reply by email within 24 business hours."}
          </Alert>
        </div>
      ) : null}
      {params.state === "invalid" ? (
        <div className="mb-6">
          <Alert tone="error">
            {locale === "ar" ? "البيانات غير مكتملة. املأ الاسم والبريد والموضوع ورسالة لا تقل عن ١٠ أحرف." : "Please complete name, email, subject and a message of at least 10 characters."}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <h2 className="font-display text-2xl text-[#f6f1e3]">{t("live_chat")}</h2>
          <p className="mt-1.5 text-[12.5px] text-[#a8a4b8]">
            {locale === "ar"
              ? "دردشة فورية مع موظف الدعم الاصطناعي — يجيب بلغتك، ويحوّلك إلى تذكرة عند الحاجة."
              : "Instant chat with our AI support employee — answers in your language and opens a ticket when needed."}
          </p>
          <div className="mt-4">
            <AgentChat agents={chatAgents} locale={locale} currency={currency} compact />
          </div>

          <div className="glass mt-6 rounded-2xl p-5">
            <h2 className="font-display text-xl text-[#f4efe3]">{t("create_ticket")}</h2>
            <p className="mt-1 text-[12px] text-[#a09db3]">
              {locale === "ar" ? "كل تذكرة تُراجع من مكتب المدير ويصلك الرد على بريدك." : "Every ticket is reviewed in the owner's office and answered by email."}
            </p>
            <form action={createSupportTicket} className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="t-name" className="mb-1 block text-[11px] text-[#b3a98f]">
                    {t("full_name")}
                  </label>
                  <input id="t-name" name="name" required minLength={2} maxLength={120} className="field" placeholder={locale === "ar" ? "مثال: نورة الغامدي" : "e.g. Nora Alghamdi"} />
                </div>
                <div>
                  <label htmlFor="t-email" className="mb-1 block text-[11px] text-[#b3a98f]">
                    {t("email")}
                  </label>
                  <input id="t-email" name="email" type="email" required className="field" dir="ltr" placeholder="name@example.com" />
                </div>
              </div>
              <div>
                <label htmlFor="t-subject" className="mb-1 block text-[11px] text-[#b3a98f]">
                  {locale === "ar" ? "الموضوع" : "Subject"}
                </label>
                <input id="t-subject" name="subject" required minLength={3} maxLength={180} className="field" placeholder={locale === "ar" ? "مثال: لم يصل رابط التحميل" : "e.g. Download link not received"} />
              </div>
              <div>
                <label htmlFor="t-order" className="mb-1 block text-[11px] text-[#b3a98f]">
                  {locale === "ar" ? "رقم الطلب (اختياري)" : "Order number (optional)"}
                </label>
                <input id="t-order" name="orderNumber" className="field" dir="ltr" placeholder="AST-4F2A1C" />
              </div>
              <div>
                <label htmlFor="t-message" className="mb-1 block text-[11px] text-[#b3a98f]">
                  {locale === "ar" ? "تفاصيل المشكلة" : "Issue details"}
                </label>
                <textarea id="t-message" name="message" required minLength={10} rows={5} className="field" placeholder={locale === "ar" ? "اشرح ما حدث بالتفصيل لنتمكن من الحل من أول رد." : "Describe what happened so we can resolve it on the first reply."} />
              </div>
              <button type="submit" className="btn-gold w-full">
                {t("create_ticket")}
              </button>
            </form>
          </div>
        </div>

        <div>
          <div className="glass rounded-2xl p-5">
            <h2 className="font-display text-xl text-[#f4efe3]">{t("faq")}</h2>
            <div className="mt-3 space-y-2">
              {faqs.map((faq) => (
                <details key={faq.id} className="group rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                  <summary className="cursor-pointer list-none text-[12.5px] text-[#f0ecdf] marker:hidden">
                    <span className="me-1.5 text-[#d9b26a]" aria-hidden="true">
                      +
                    </span>
                    {faq.question}
                  </summary>
                  <p className="mt-2 ps-4 text-[12.5px] leading-relaxed text-[#a8a4b8]">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>

          <div className="glass mt-4 rounded-2xl p-5">
            <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "قنوات التواصل" : "Contact channels"}</h2>
            <ul className="mt-3 space-y-2.5 text-[12.5px] text-[#a9a4b8]">
              <li>
                {locale === "ar" ? "البريد:" : "Email:"}{" "}
                <a href={`mailto:${settings.supportEmail}`} className="text-[#e6d6ae] hover:underline" dir="ltr">
                  {settings.supportEmail}
                </a>
              </li>
              <li>
                {locale === "ar" ? "واتساب الدعم:" : "Support WhatsApp:"}{" "}
                <a href={`https://wa.me/${settings.whatsapp.replace(/[^0-9]/g, "")}`} className="text-[#e6d6ae] hover:underline" dir="ltr" target="_blank" rel="noreferrer noopener">
                  {settings.whatsapp}
                </a>
              </li>
              <li>{locale === "ar" ? "أوقات الرد: خلال 24 ساعة عمل، والأولوية للتذاكر المرتبطة بطلب." : "Response time: within 24 business hours, priority to order-linked tickets."}</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/refunds" className="btn-ghost px-3 py-1.5 text-[11.5px]">
                {t("refunds")}
              </Link>
              <Link href="/account" className="btn-ghost px-3 py-1.5 text-[11.5px]">
                {t("nav_account")}
              </Link>
              <Link href="/contact" className="btn-ghost px-3 py-1.5 text-[11.5px]">
                {t("nav_contact")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
