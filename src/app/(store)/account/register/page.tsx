import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CustomerAuthForm } from "@/components/customer-auth-form";
import { getCustomerSession } from "@/lib/auth";
import { getLocaleContext } from "@/lib/locale";

export const metadata: Metadata = { title: "إنشاء حساب" };

type SearchParams = Promise<{ ref?: string }>;

export default async function AccountRegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getLocaleContext();
  const customer = await getCustomerSession();
  if (customer) redirect("/account");

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 lg:grid-cols-2 lg:items-center">
      <div>
        <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("account_title")}</p>
        <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{t("register")}</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[#ada8bb]">
          {locale === "ar"
            ? "أنشئ حسابك مرة واحدة، وستجد كل مشترياتك وفواتيرك وروابط التحميل في مكان واحد آمن."
            : "Create your account once, and find every purchase, invoice and download in one secure place."}
        </p>
        <div className="glass mt-5 rounded-xl p-4 text-[12px] leading-relaxed text-[#b8b3c5]">
          {locale === "ar"
            ? "نحفظ كلمة المرور مشفّرة بخوارزمية scrypt ولا نستطيع قراءتها. لا نطلب أبدًا بياناتك البنكية في الحساب."
            : "Passwords are hashed with scrypt and cannot be read by us. We never ask for banking details in your account."}
        </div>
      </div>
      <div className="glass rounded-2xl p-6">
        <CustomerAuthForm
          mode="register"
          referral={params.ref}
          labels={{
            name: t("full_name"),
            email: t("email"),
            password: t("password"),
            submit: t("register"),
            altText: locale === "ar" ? "لديك حساب بالفعل؟" : "Already have an account?",
            altLink: t("sign_in"),
            refLabel: locale === "ar" ? "رمز الإحالة (اختياري)" : "Referral code (optional)",
          }}
        />
      </div>
    </div>
  );
}
