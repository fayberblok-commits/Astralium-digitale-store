import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CustomerAuthForm } from "@/components/customer-auth-form";
import { getCustomerSession } from "@/lib/auth";
import { getLocaleContext } from "@/lib/locale";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function AccountLoginPage() {
  const { locale, t } = await getLocaleContext();
  const customer = await getCustomerSession();
  if (customer) redirect("/account");

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 lg:grid-cols-2 lg:items-center">
      <div>
        <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("account_title")}</p>
        <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{t("sign_in")}</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-[#ada8bb]">
          {locale === "ar"
            ? "سجّل الدخول للوصول إلى مشترياتك، تحميل الملفات، الفواتير، وإعداداتك — مع الاحتفاظ بروابط تحميل آمنة دائمًا."
            : "Sign in to reach your purchases, file downloads, invoices and settings — with permanent secure download links."}
        </p>
        <ul className="mt-5 space-y-2 text-[12.5px] text-[#a9a4b8]">
          <li>{locale === "ar" ? "✦ مشترياتك محفوظة حتى لو غيّرت جهازك." : "✦ Purchases stay available across devices."}</li>
          <li>{locale === "ar" ? "✦ فواتير قابلة للطباعة في أي وقت." : "✦ Printable invoices at any time."}</li>
          <li>{locale === "ar" ? "✦ رمز إحالة شخصي لمشاركة المتجر." : "✦ A personal referral code."}</li>
        </ul>
        <Link href="/support" className="btn-ghost mt-5 text-[12px]">
          {locale === "ar" ? "نسيت كلمة المرور؟ تواصل مع الدعم" : "Forgot your password? Contact support"}
        </Link>
      </div>
      <div className="glass rounded-2xl p-6">
        <CustomerAuthForm
          mode="login"
          labels={{
            name: t("full_name"),
            email: t("email"),
            password: t("password"),
            submit: t("sign_in"),
            altText: locale === "ar" ? "ليس لديك حساب؟" : "No account yet?",
            altLink: t("register"),
            refLabel: locale === "ar" ? "رمز الإحالة (اختياري)" : "Referral code (optional)",
          }}
        />
      </div>
    </div>
  );
}
