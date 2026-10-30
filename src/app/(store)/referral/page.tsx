import Link from "next/link";
import type { Metadata } from "next";
import { getCustomerSession } from "@/lib/auth";
import { getLocaleContext } from "@/lib/locale";

export const metadata: Metadata = {
  title: "برنامج الإحالة",
  description: "شارك رابط Astralium واحصل أنت وصديقك على رصيد عند أول عملية شراء مؤكدة.",
};

export default async function ReferralPage() {
  const { locale, t } = await getLocaleContext();
  const customer = await getCustomerSession();
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  const link = customer ? `${origin}/account/register?ref=${customer.referralCode}` : "";

  const steps = [
    {
      ar: "١. شارك رمزك أو رابط الإحالة مع من تعرف.",
      en: "1. Share your code or referral link with people you know.",
    },
    {
      ar: "٢. يسجّل صديقك حسابًا جديدًا ويُدخل رمزك.",
      en: "2. Your friend creates a new account and enters your code.",
    },
    {
      ar: "٣. بعد أول شراء مؤكد لكليكما رصيد مكافأة.",
      en: "3. After the first confirmed purchase, both of you receive credit.",
    },
    {
      ar: "٤. يُستخدم الرصيد كخصم على الطلب التالي عبر كوبون مخصص.",
      en: "4. Credit is redeemed as a discount on a future order via a dedicated coupon.",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("nav_referral")}</p>
      <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">
        {locale === "ar" ? "برنامج الإحالة" : "Referral programme"}
      </h1>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[#b1acc0]">
        {locale === "ar"
          ? "علاقة طويلة مع القرّاء والمبدعين تُبنى بالثقة. شارك Astralium مع من تعرف، وستحصل أنت وصديقك على رصيد عند أول شراء مؤكد."
          : "Long relationships with readers and makers are built on trust. Share Astralium, and both you and your friend receive credit after the first confirmed purchase."}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <div className="glass rounded-2xl p-6">
          <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "رمزك الشخصي" : "Your personal code"}</h2>
          {customer ? (
            <>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-[rgba(217,178,106,0.45)] bg-[rgba(217,178,106,0.06)] px-4 py-3">
                <span className="font-mono text-lg tracking-[0.2em] text-[#f4e4bb]">{customer.referralCode}</span>
                <span className="chip">{locale === "ar" ? "نشط" : "Active"}</span>
              </div>
              <p className="mt-3 break-all rounded-xl bg-[#080a17]/80 px-3 py-2 text-[11.5px] text-[#b9b4c6]" dir="ltr">
                {link}
              </p>
              <p className="mt-2 text-[11.5px] text-[#a09db3]">
                {locale === "ar" ? "شارك الرابط كما هو. لا نطلب من أصدقائك أي معلومة دفع إضافية." : "Share the link as is. Your friends are never asked for extra payment details."}
              </p>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-[12.5px] leading-relaxed text-[#a9a4b8]">
              {locale === "ar" ? "سجّل الدخول أو أنشئ حسابًا لعرض رمز الإحالة الخاص بك." : "Sign in or create an account to see your referral code."}
              <div className="mt-3 flex gap-2">
                <Link href="/account/login" className="btn-gold px-4 py-2 text-[12px]">
                  {t("sign_in")}
                </Link>
                <Link href="/account/register" className="btn-ghost px-4 py-2 text-[12px]">
                  {t("register")}
                </Link>
              </div>
            </div>
          )}

          <h2 className="mt-7 font-display text-xl text-[#f4efe3]">{locale === "ar" ? "كيف يعمل؟" : "How it works"}</h2>
          <ol className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-[#a9a4b8]">
            {steps.map((step) => (
              <li key={step.en}>{locale === "ar" ? step.ar : step.en}</li>
            ))}
          </ol>
        </div>

        <div className="glass rounded-2xl p-6">
          <h2 className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "قيمة المكافأة" : "Reward value"}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#a9a4b8]">
            {locale === "ar"
              ? "١٠٪ رصيد لكل طرف عند أول شراء مؤكد للصديق. يُحتسب الرصيد بالدولار ويُحوّل لعملتك عند إصدار الكوبون."
              : "10% credit for each side after the friend's first confirmed purchase. Credit is held in USD and converted at coupon issue."}
          </p>
          <ul className="mt-4 space-y-2 text-[12px] text-[#a9a4b8]">
            <li>{locale === "ar" ? "• لا حد لعدد الإحالات." : "• Unlimited referrals."}</li>
            <li>{locale === "ar" ? "• لا يُحتسب الرصيد على الطلبات المسترجعة." : "• Refunded orders do not earn credit."}</li>
            <li>{locale === "ar" ? "• يمكن استخدام رصيد واحد لكل طلب." : "• One credit redemption per order."}</li>
            <li>{locale === "ar" ? "• يُصدر الكوبون من مكتب المدير بعد التحقق من الطلب." : "• Coupons are issued by the owner's office after order verification."}</li>
          </ul>
          <div className="mt-5 rounded-xl border border-[rgba(217,178,106,0.25)] bg-[rgba(217,178,106,0.06)] p-3 text-[11.5px] leading-relaxed text-[#d7c8a4]">
            {locale === "ar"
              ? "ملاحظة: أي محاولة إنشاء حسابات مكررة لإساءة استخدام البرنامج تؤدي إلى إلغاء المكافآت."
              : "Note: duplicate accounts created to abuse the programme void all credit."}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/catalog" className="btn-gold px-4 py-2 text-[12px]">
              {t("browse")}
            </Link>
            <Link href="/support" className="btn-ghost px-4 py-2 text-[12px]">
              {t("nav_support")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
