import Link from "next/link";
import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { submitContact } from "@/app/actions";
import { getLocaleContext } from "@/lib/locale";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  title: "اتصل بنا",
  description: "راسل فريق Astralium Digitale Store للاستفسارات العامة، الشراكات، أو الدعم المرتبط بطلب.",
};

type SearchParams = Promise<{ state?: string }>;

export default async function ContactPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getLocaleContext();
  const settings = await getSettings();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("nav_contact")}</p>
      <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{t("nav_contact")}</h1>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[#b1acc0]">
        {locale === "ar"
          ? "اختر القناة الأنسب: التذاكر لمشاكل الطلبات، النموذج أدناه للاستفسارات العامة والشراكات، والدردشة للأسئلة السريعة."
          : "Choose the right channel: tickets for order issues, the form below for general enquiries and partnerships, chat for quick questions."}
      </p>

      {params.state === "sent" ? (
        <div className="mt-6">
          <Alert tone="success">
            {locale === "ar" ? "وصلت رسالتك إلى مكتب المتجر. سنرد على بريدك خلال يوم عمل واحد." : "Your message reached the store office. We reply within one business day."}
          </Alert>
        </div>
      ) : null}
      {params.state === "invalid" ? (
        <div className="mt-6">
          <Alert tone="error">
            {locale === "ar" ? "يرجى تعبئة الحقول بشكل صحيح، مع رسالة من ١٠ أحرف على الأقل." : "Please complete the fields correctly with a message of at least 10 characters."}
          </Alert>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <form action={submitContact} className="glass space-y-3 rounded-2xl p-5">
          <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "أرسل رسالة" : "Send a message"}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="c-name" className="mb-1 block text-[11px] text-[#b3a98f]">
                {t("full_name")}
              </label>
              <input id="c-name" name="name" required minLength={2} maxLength={120} className="field" placeholder={locale === "ar" ? "الاسم الكامل" : "Full name"} />
            </div>
            <div>
              <label htmlFor="c-email" className="mb-1 block text-[11px] text-[#b3a98f]">
                {t("email")}
              </label>
              <input id="c-email" name="email" type="email" required className="field" dir="ltr" placeholder="name@example.com" />
            </div>
          </div>
          <div>
            <label htmlFor="c-subject" className="mb-1 block text-[11px] text-[#b3a98f]">
              {locale === "ar" ? "الموضوع" : "Subject"}
            </label>
            <input id="c-subject" name="subject" required minLength={3} maxLength={180} className="field" placeholder={locale === "ar" ? "استفسار عن ترخيص تجاري" : "Commercial licence enquiry"} />
          </div>
          <div>
            <label htmlFor="c-message" className="mb-1 block text-[11px] text-[#b3a98f]">
              {locale === "ar" ? "رسالتك" : "Your message"}
            </label>
            <textarea id="c-message" name="message" required minLength={10} rows={6} className="field" placeholder={locale === "ar" ? "اكتب التفاصيل هنا…" : "Write the details here…"} />
          </div>
          <button type="submit" className="btn-gold w-full">
            {locale === "ar" ? "إرسال الرسالة" : "Send message"}
          </button>
          <p className="text-center text-[10.5px] text-[#807c91]">
            {locale === "ar" ? "لا تشارك بياناتك البنكية في أي رسالة. لن نطلبها أبدًا." : "Never share banking data in a message — we never request it."}
          </p>
        </form>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-5">
            <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "قنوات مباشرة" : "Direct channels"}</h2>
            <ul className="mt-3 space-y-2 text-[12.5px] text-[#a9a4b8]">
              <li>
                {locale === "ar" ? "البريد الإلكتروني:" : "Email:"}{" "}
                <a href={`mailto:${settings.supportEmail}`} className="text-[#e6d6ae] hover:underline" dir="ltr">
                  {settings.supportEmail}
                </a>
              </li>
              <li>
                {locale === "ar" ? "الدعم عبر واتساب:" : "Support WhatsApp:"}{" "}
                <a href={`https://wa.me/${settings.whatsapp.replace(/[^0-9]/g, "")}`} className="text-[#e6d6ae] hover:underline" dir="ltr" target="_blank" rel="noreferrer noopener">
                  {settings.whatsapp}
                </a>
              </li>
              <li>
                {locale === "ar" ? "المتابعة الاجتماعية:" : "Social:"}{" "}
                <a href={settings.instagram} className="text-[#e6d6ae] hover:underline" target="_blank" rel="noreferrer noopener">
                  Instagram
                </a>{" "}
                ·{" "}
                <a href={settings.x} className="text-[#e6d6ae] hover:underline" target="_blank" rel="noreferrer noopener">
                  X
                </a>{" "}
                ·{" "}
                <a href={settings.linkedin} className="text-[#e6d6ae] hover:underline" target="_blank" rel="noreferrer noopener">
                  LinkedIn
                </a>
              </li>
            </ul>
          </div>
          <div className="glass rounded-2xl p-5">
            <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "قبل أن تراسلنا" : "Before you write"}</h2>
            <ul className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-[#a9a4b8]">
              <li>{locale === "ar" ? "• رابط التحميل تجده في «حسابي → تحميل الملفات» أو في بريد التأكيد." : "• Download links are in “My account → Downloads” and in your confirmation email."}</li>
              <li>{locale === "ar" ? "• الفواتير متاحة للطباعة من صفحة الطلب." : "• Invoices are printable from the order page."}</li>
              <li>{locale === "ar" ? "• للاسترجاع: صفحة السياسة ثم تذكرة برقم الطلب." : "• For refunds: read the policy then open a ticket with your order number."}</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/support" className="btn-ghost px-3 py-1.5 text-[11.5px]">
                {t("nav_support")}
              </Link>
              <Link href="/agents" className="btn-ghost px-3 py-1.5 text-[11.5px]">
                {t("nav_agents")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
