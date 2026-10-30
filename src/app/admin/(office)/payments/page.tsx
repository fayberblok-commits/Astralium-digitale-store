import type { Metadata } from "next";
import Link from "next/link";
import { saveGatewayMode, savePayoutDetailsAction } from "@/app/admin/actions";
import { getMaskedPayoutDetails, getSettings, gatewayEnvStatus } from "@/lib/settings";
import { CURRENCIES } from "@/lib/money";

export const metadata: Metadata = { title: "الدفع والحساب البنكي", robots: { index: false, follow: false } };

type SearchParams = Promise<{ state?: string }>;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const [settings, payout] = await Promise.all([getSettings(), getMaskedPayoutDetails()]);
  const env = gatewayEnvStatus();

  const notices: Record<string, string> = {
    vault_saved: "تم تشفير بيانات الحساب وحفظها. لن تظهر كاملة مرة أخرى.",
    vault_cleared: "تم حذف بيانات الحساب البنكي من الخزنة.",
    invalid: "أكمل اسم صاحب الحساب واسم البنك وIBAN صحيح.",
    mode_saved: "تم تحديث وضع الدفع.",
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">الدفع والحساب البنكي</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">قسم خاص بالمالك: بيانات الاستلام، حالة البوابات، والتحقق من مسارات الدفع. لا يظهر في أي صفحة للمشترين.</p>
      </div>

      {params.state && notices[params.state] ? (
        <div className="rounded-xl border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] px-4 py-2.5 text-[12px] text-[#f0dcae]">{notices[params.state]}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <form action={savePayoutDetailsAction} className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">بيانات الاستلام (تُخزَّن مشفّرة)</h2>
          {payout ? (
            <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[11.5px] text-[#a9a4b8]">
              <p className="mb-1 text-[9.5px] uppercase tracking-[0.18em] text-[#a99c83]">المحفوظ حاليًا (مخفي جزئيًا)</p>
              <p>صاحب الحساب: {payout.accountHolder}</p>
              <p>البنك: {payout.bankName}</p>
              <p dir="ltr">IBAN: {payout.iban}</p>
              <p dir="ltr">SWIFT/BIC: {payout.swift}</p>
              <p>{payout.country} · {payout.currency}</p>
              <p dir="ltr">Tax ID: {payout.taxId}</p>
            </div>
          ) : (
            <p className="mt-2 text-[11.5px] leading-relaxed text-[#a9a4b8]">لم تُحفظ بيانات بعد. تُشفَّر بـ AES-256-GCM عبر مفتاح الخادم ولا تظهر كاملة بعد الحفظ.</p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="v-holder" className="mb-1 block text-[10.5px] text-[#a99c83]">اسم صاحب الحساب *</label>
              <input id="v-holder" name="accountHolder" required minLength={2} className="field text-[12px]" />
            </div>
            <div>
              <label htmlFor="v-bank" className="mb-1 block text-[10.5px] text-[#a99c83]">اسم البنك *</label>
              <input id="v-bank" name="bankName" required minLength={2} className="field text-[12px]" />
            </div>
            <div>
              <label htmlFor="v-iban" className="mb-1 block text-[10.5px] text-[#a99c83]">IBAN *</label>
              <input id="v-iban" name="iban" required minLength={8} className="field text-[12px] font-mono" dir="ltr" placeholder="SA0000000000000000000000" />
            </div>
            <div>
              <label htmlFor="v-swift" className="mb-1 block text-[10.5px] text-[#a99c83]">SWIFT / BIC</label>
              <input id="v-swift" name="swift" className="field text-[12px] font-mono" dir="ltr" placeholder="RJHISARI" />
            </div>
            <div>
              <label htmlFor="v-country" className="mb-1 block text-[10.5px] text-[#a99c83]">الدولة (ISO)</label>
              <input id="v-country" name="country" maxLength={2} className="field text-[12px] uppercase" dir="ltr" placeholder="SA" />
            </div>
            <div>
              <label htmlFor="v-currency" className="mb-1 block text-[10.5px] text-[#a99c83]">عملة الاستلام</label>
              <select id="v-currency" name="currency" className="field text-[12px]">
                {CURRENCIES.map((currency) => (
                  <option key={currency.code} value={currency.code}>{currency.code} — {currency.labelAr}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="v-tax" className="mb-1 block text-[10.5px] text-[#a99c83]">الرقم الضريبي (اختياري)</label>
              <input id="v-tax" name="taxId" className="field text-[12px]" dir="ltr" />
            </div>
          </div>
          <button type="submit" className="btn-gold mt-3 w-full">تشفير وحفظ البيانات</button>
          <p className="mt-2 text-[10px] leading-relaxed text-[#807c91]">
            لا تُعرض هذه البيانات في المتجر أو الواجهة. يمكنك استبدالها في أي وقت بإدخال بيانات جديدة فوق المحفوظة.
          </p>
        </form>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-4">
            <h2 className="font-display text-lg text-[#f4efe3]">حالة بوابات الدفع</h2>
            <div className="mt-2 space-y-2 text-[11.5px]">
              {[
                { name: "Stripe — بطاقات، Apple Pay، Google Pay", ready: env.stripe, envKey: "STRIPE_SECRET_KEY" },
                { name: "Stripe Webhook — توقيع الطلبات", ready: env.stripeWebhook, envKey: "STRIPE_WEBHOOK_SECRET" },
                { name: `PayPal (${env.paypalMode})`, ready: env.paypal, envKey: "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET" },
                { name: "PayPal Webhook", ready: env.paypalWebhook, envKey: "PAYPAL_WEBHOOK_ID" },
                { name: "بريد المعاملات (Resend)", ready: env.email, envKey: "RESEND_API_KEY" },
                { name: "طبقة الذكاء اللغوي", ready: env.ai, envKey: "OPENAI_API_KEY" },
              ].map((item) => (
                <div key={item.name} className="flex items-start justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
                  <div>
                    <p className="text-[#ded9e7]">{item.name}</p>
                    <p className="font-mono text-[9.5px] text-[#807c91]" dir="ltr">{item.envKey}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] ${item.ready ? "border-emerald-400/30 text-emerald-200" : "border-amber-300/30 text-amber-100"}`}>
                    {item.ready ? "مهيأ" : "بانتظار المفتاح"}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[#807c91]">
              المفاتيح لا تُخزَّن في قاعدة البيانات ولا في الواجهة؛ تُضاف كمتغيرات بيئة على الخادم فقط. هذا القسم يعرض حالتها دون كشفها.
            </p>
          </div>

          <form action={saveGatewayMode} className="glass rounded-2xl p-4">
            <h2 className="font-display text-lg text-[#f4efe3]">وضع الدفع</h2>
            <p className="mt-1 text-[11px] text-[#a9a4b8]">
              الوضع الحالي: <span className={settings.testMode ? "text-amber-200" : "text-emerald-300"}>{settings.testMode ? "اختبار (بوابة محاكاة)" : "حقيقي (البوابات فقط)"}</span>
            </p>
            <label className="mt-3 flex items-center gap-2 text-[11.5px] text-[#c3bece]">
              <input type="checkbox" name="testMode" defaultChecked={settings.testMode} className="h-4 w-4" />
              السماح ببوابة الاختبار في المتجر
            </label>
            <button type="submit" className="btn-ghost mt-3 w-full py-1.5 text-[11.5px]">حفظ الوضع</button>
          </form>

          <div className="glass rounded-2xl p-4 text-[11px] leading-relaxed text-[#a9a4b8]">
            <h2 className="font-display text-base text-[#f0dcae]">مسار الدفع المُختبر</h2>
            <ol className="mt-2 space-y-1.5">
              <li>١. إنشاء طلب بحالة pending مع منع تكرار الشراء لنفس البريد/المنتج.</li>
              <li>٢. اختيار البوابة ← إنشاء جلسة دفع وتسجيل مرجعها.</li>
              <li>٣. تأكيد الدفع عبر البوابة أو Webhook موقّع (توقيع Stripe، تحقق PayPal).</li>
              <li>٤. تسليم فوري: ترخيص + روابط موقّعة 72 ساعة + فاتورة + بريد.</li>
              <li>٥. الاسترجاع من صفحة الطلبات يُلغي صلاحية التحميل ويسجّل العملية.</li>
            </ol>
            <Link href="/admin/orders" className="btn-ghost mt-3 inline-flex px-3 py-1.5 text-[10.5px]">مراجعة الطلبات</Link>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl border border-rose-400/20 p-4">
        <p className="text-[11px] leading-relaxed text-rose-100/90">
          تنبيه أمني: لا تُرسل بيانات الحساب البنكي أو المفاتيح لأي موظف اصطناعي أو تذكرة دعم. الخزنة هنا مشفّرة، والمفاتيح السرية تبقى في بيئة الخادم فقط. أي محاولة لطلبها عبر المحادثة تُرفض وتُسجَّل.
        </p>
      </div>
    </div>
  );
}
