import Link from "next/link";
import type { Metadata } from "next";
import { Alert } from "@/components/ui";
import { getCustomerSession } from "@/lib/auth";
import { getCustomerOrders } from "@/lib/store";
import { getLocaleContext, formatDateTime } from "@/lib/locale";
import { downloadUrl } from "@/lib/downloads";
import { formatAmount } from "@/lib/money";
import { customerLogout, requestRefund, updateCustomerPassword, updateCustomerProfile } from "@/app/actions";

export const metadata: Metadata = { title: "حسابي" };

type SearchParams = Promise<{ tab?: string; state?: string }>;

const STATUS: Record<string, { ar: string; en: string; tone: string }> = {
  paid: { ar: "مدفوع", en: "Paid", tone: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" },
  pending: { ar: "بانتظار الدفع", en: "Awaiting payment", tone: "text-amber-200 border-amber-300/30 bg-amber-300/10" },
  failed: { ar: "فشل الدفع", en: "Payment failed", tone: "text-rose-200 border-rose-400/30 bg-rose-400/10" },
  refunded: { ar: "مسترجع", en: "Refunded", tone: "text-sky-200 border-sky-400/30 bg-sky-400/10" },
  cancelled: { ar: "ملغى", en: "Cancelled", tone: "text-white/60 border-white/15 bg-white/5" },
};

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getLocaleContext();
  const customer = await getCustomerSession();

  if (!customer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="glass rounded-2xl p-8 text-center">
          <p className="text-2xl" aria-hidden="true">
            ◐
          </p>
          <h1 className="mt-2 font-display text-2xl text-[#f8f3e6]">{t("account_title")}</h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[#a9a4b8]">
            {locale === "ar"
              ? "سجّل الدخول لعرض مشترياتك وتحميل ملفاتك وفواتيرك. إذا اشتريت كضيف فستجد روابط التحميل في صفحة الطلب وبريد التأكيد."
              : "Sign in to view purchases, downloads and invoices. If you bought as a guest, your links are on the order page and in the confirmation email."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/account/login" className="btn-gold">
              {t("sign_in")}
            </Link>
            <Link href="/account/register" className="btn-ghost">
              {t("register")}
            </Link>
            <Link href="/support" className="btn-ghost">
              {t("nav_support")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const orders = await getCustomerOrders(customer.id);
  const paidOrders = orders.filter((entry) => entry.order.status === "paid");
  const tab = params.tab ?? "purchases";
  const stateMessage =
    params.state === "welcome"
      ? locale === "ar"
        ? "تم إنشاء حسابك بنجاح، ومرحبًا بك في Astralium."
        : "Your account is ready — welcome to Astralium."
      : params.state === "profile_saved"
        ? locale === "ar"
          ? "تم تحديث بيانات حسابك."
          : "Your account details were updated."
        : params.state === "password_saved"
          ? locale === "ar"
            ? "تم تغيير كلمة المرور بنجاح."
            : "Password changed successfully."
          : params.state === "password_invalid"
            ? locale === "ar"
              ? "كلمة المرور الحالية غير صحيحة."
              : "Current password is incorrect."
            : params.state === "password_short"
              ? locale === "ar"
                ? "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل."
                : "New password must be at least 8 characters."
              : params.state === "refund_requested"
                ? locale === "ar"
                  ? "تم إرسال طلب الاسترجاع إلى مكتب الدعم، وسيتم الرد عليك عبر بريدك."
                  : "Your refund request reached the support office; we will reply by email."
                : null;

  const tabs = [
    { key: "purchases", label: t("purchases") },
    { key: "downloads", label: t("downloads") },
    { key: "invoices", label: t("invoices") },
    { key: "settings", label: t("settings") },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("account_title")}</p>
          <h1 className="mt-2 font-display text-3xl text-[#f8f3e6]">{customer.name}</h1>
          <p className="mt-1 text-[12.5px] text-[#a09db3]" dir="ltr">
            {customer.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/catalog" className="btn-ghost px-3 py-1.5 text-[11.5px]">
            {t("browse")}
          </Link>
          <form action={customerLogout}>
            <button type="submit" className="rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] text-[#c9c4d4] hover:border-rose-300/40 hover:text-rose-200">
              {t("sign_out")}
            </button>
          </form>
        </div>
      </div>

      {stateMessage ? (
        <div className="mt-5">
          <Alert tone={params.state?.includes("invalid") || params.state?.includes("short") ? "error" : "success"}>{stateMessage}</Alert>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={`/account?tab=${item.key}`}
            className={`rounded-full px-3.5 py-1.5 text-[12px] ${
              tab === item.key ? "bg-[rgba(217,178,106,0.16)] text-[#f7eccd]" : "text-[#b3aec1] hover:text-[#f0dcae]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: locale === "ar" ? "طلبات مدفوعة" : "Paid orders", value: paidOrders.length },
          { label: locale === "ar" ? "إجمالي المشتريات" : "Lifetime value", value: formatAmount(paidOrders.reduce((sum, entry) => sum + entry.order.totalCents, 0), paidOrders[0]?.order.currency ?? "USD", locale) },
          { label: locale === "ar" ? "ملفات متاحة" : "Available files", value: paidOrders.reduce((sum, entry) => sum + entry.items.length, 0) },
        ].map((stat) => (
          <div key={stat.label} className="glass rounded-2xl p-4">
            <p className="text-[10.5px] uppercase tracking-[0.2em] text-[#a99c83]">{stat.label}</p>
            <p className="tabular mt-1 font-display text-2xl text-[#f0dcae]">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        {tab === "purchases" ? (
          orders.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <p className="text-[13px] text-[#a9a4b8]">{locale === "ar" ? "لا توجد طلبات على هذا الحساب بعد." : "No orders on this account yet."}</p>
              <Link href="/catalog" className="btn-gold mt-4">
                {t("hero_cta")}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map(({ order, items }) => {
                const status = STATUS[order.status] ?? STATUS.pending;
                return (
                  <div key={order.id} className="glass rounded-2xl p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-[12.5px] text-[#f0dcae]">{order.orderNumber}</p>
                        <p className="text-[11px] text-[#8f8ba2]">{formatDateTime(order.createdAt, locale)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10.5px] ${status.tone}`}>{locale === "ar" ? status.ar : status.en}</span>
                        <span className="tabular text-[13px] text-[#f4efe3]">{formatAmount(order.totalCents, order.currency, locale)}</span>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {items.map(({ item, product }) => (
                        <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5 text-[12px]">
                          <Link href={`/product/${product.slug}`} className="text-[#eee9dd] hover:text-[#f0dcae]">
                            {locale === "ar" ? product.title : product.titleEn || product.title}
                          </Link>
                          <span className="tabular text-[#a9a4b8]">{formatAmount(item.unitPriceCents, order.currency, locale)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {order.status === "paid" ? (
                        <>
                          {items.map(({ product }) => (
                            <a key={product.id} href={downloadUrl(order.orderNumber, product.id)} className="btn-gold px-3 py-1.5 text-[11.5px]">
                              {locale === "ar" ? `تحميل ${product.title.slice(0, 22)}` : `Download ${(product.titleEn || product.title).slice(0, 22)}`}
                            </a>
                          ))}
                        </>
                      ) : order.status === "pending" || order.status === "failed" ? (
                        <Link href={`/checkout?product=${items[0]?.product.slug ?? ""}`} className="btn-gold px-3 py-1.5 text-[11.5px]">
                          {locale === "ar" ? "إكمال الدفع" : "Complete payment"}
                        </Link>
                      ) : null}
                      <Link href={`/invoice/${order.orderNumber}`} className="btn-ghost px-3 py-1.5 text-[11.5px]">
                        {t("invoices")}
                      </Link>
                      {order.status === "paid" ? (
                        <details className="ms-auto">
                          <summary className="cursor-pointer text-[11px] text-[#a9a4b8] hover:text-[#f0dcae]">
                            {locale === "ar" ? "طلب استرجاع" : "Request refund"}
                          </summary>
                          <form action={requestRefund} className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input type="hidden" name="orderNumber" value={order.orderNumber} />
                            <input name="message" placeholder={locale === "ar" ? "سبب الاسترجاع" : "Reason"} className="field text-[11.5px]" />
                            <button type="submit" className="btn-ghost whitespace-nowrap px-3 py-1.5 text-[11px]">
                              {locale === "ar" ? "إرسال" : "Send"}
                            </button>
                          </form>
                        </details>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "downloads" ? (
          paidOrders.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center text-[13px] text-[#a9a4b8]">
              {locale === "ar" ? "لا توجد ملفات متاحة بعد. بعد تأكيد الدفع تظهر هنا فورًا." : "No files yet. They appear here immediately after payment confirmation."}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {paidOrders.flatMap(({ order, items }) =>
                items.map(({ item, product }) => (
                  <div key={`${order.id}-${item.id}`} className="glass rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] text-[#f2eddf]">{locale === "ar" ? product.title : product.titleEn || product.title}</p>
                        <p className="text-[11px] text-[#8f8ba2]">
                          {order.orderNumber} · {product.fileName ?? `${product.format} · ${product.fileSizeKb ? `${Math.round(product.fileSizeKb / 1024)} MB` : "Digital edition"}`}
                        </p>
                      </div>
                      <span className="chip">{`${item.downloadCount}/${item.downloadLimit}`}</span>
                    </div>
                    <a href={downloadUrl(order.orderNumber, product.id)} className="btn-gold mt-3 w-full py-2 text-[12px]">
                      {locale === "ar" ? "تحميل آمن" : "Secure download"}
                    </a>
                    <p className="mt-2 text-[10.5px] text-[#807c91]">
                      {locale === "ar" ? "رابط موقّع ينتهي خلال 72 ساعة ويمكن إعادة إنشائه من هنا." : "Signed link expires in 72 hours and can be regenerated here."}
                    </p>
                  </div>
                )),
              )}
            </div>
          )
        ) : null}

        {tab === "invoices" ? (
          orders.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center text-[13px] text-[#a9a4b8]">{locale === "ar" ? "لا توجد فواتير بعد." : "No invoices yet."}</div>
          ) : (
            <div className="table-wrap glass rounded-2xl">
              <table className="w-full text-[12px]">
                <thead className="bg-white/[0.03] text-[10.5px] uppercase tracking-[0.18em] text-[#a99c83]">
                  <tr>
                    <th className="px-4 py-3 text-start">{locale === "ar" ? "الفاتورة" : "Invoice"}</th>
                    <th className="px-4 py-3 text-start">{locale === "ar" ? "التاريخ" : "Date"}</th>
                    <th className="px-4 py-3 text-start">{locale === "ar" ? "الحالة" : "Status"}</th>
                    <th className="px-4 py-3 text-start">{t("total")}</th>
                    <th className="px-4 py-3 text-start" />
                  </tr>
                </thead>
                <tbody>
                  {orders.map(({ order }) => {
                    const status = STATUS[order.status] ?? STATUS.pending;
                    return (
                      <tr key={order.id} className="border-t border-white/5">
                        <td className="px-4 py-3 font-mono text-[#f0dcae]">{order.orderNumber}</td>
                        <td className="px-4 py-3 text-[#a9a4b8]">{formatDateTime(order.createdAt, locale)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10.5px] ${status.tone}`}>{locale === "ar" ? status.ar : status.en}</span>
                        </td>
                        <td className="tabular px-4 py-3 text-[#f4efe3]">{formatAmount(order.totalCents, order.currency, locale)}</td>
                        <td className="px-4 py-3">
                          <Link href={`/invoice/${order.orderNumber}`} className="text-[#e6d6ae] hover:underline">
                            {locale === "ar" ? "عرض / طباعة" : "View / print"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "settings" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <form action={updateCustomerProfile} id="settings" className="glass rounded-2xl p-5">
              <h2 className="font-display text-lg text-[#f4efe3]">{locale === "ar" ? "بيانات الحساب" : "Account details"}</h2>
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="s-name" className="mb-1 block text-[11px] text-[#b3a98f]">
                    {t("full_name")}
                  </label>
                  <input id="s-name" name="name" defaultValue={customer.name} className="field" required minLength={2} />
                </div>
                <div>
                  <label htmlFor="s-country" className="mb-1 block text-[11px] text-[#b3a98f]">
                    {locale === "ar" ? "الدولة" : "Country"}
                  </label>
                  <input id="s-country" name="country" className="field" placeholder={locale === "ar" ? "السعودية" : "Saudi Arabia"} />
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[#b8b3c5]">
                  <input type="checkbox" name="marketingOptIn" className="h-4 w-4 rounded border-white/20 bg-transparent" />
                  {locale === "ar" ? "أرغب في استلام إصدارات وعروض عبر البريد." : "Send me releases and offers by email."}
                </label>
                <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-[11.5px] text-[#a9a4b8]">
                  {locale === "ar" ? "رمز الإحالة الخاص بك: " : "Your referral code: "}
                  <span className="font-mono text-[#f0dcae]">{customer.referralCode}</span>
                </div>
                <button type="submit" className="btn-gold w-full">
                  {t("saved")}
                </button>
              </div>
            </form>

            <form action={updateCustomerPassword} className="glass rounded-2xl p-5">
              <h2 className="font-display text-lg text-[#f4efe3]">{locale === "ar" ? "كلمة المرور" : "Password"}</h2>
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="s-current" className="mb-1 block text-[11px] text-[#b3a98f]">
                    {locale === "ar" ? "كلمة المرور الحالية" : "Current password"}
                  </label>
                  <input id="s-current" name="currentPassword" type="password" required className="field" dir="ltr" autoComplete="current-password" />
                </div>
                <div>
                  <label htmlFor="s-new" className="mb-1 block text-[11px] text-[#b3a98f]">
                    {locale === "ar" ? "كلمة المرور الجديدة" : "New password"}
                  </label>
                  <input id="s-new" name="newPassword" type="password" required minLength={8} className="field" dir="ltr" autoComplete="new-password" />
                </div>
                <button type="submit" className="btn-gold w-full">
                  {locale === "ar" ? "تحديث كلمة المرور" : "Update password"}
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
