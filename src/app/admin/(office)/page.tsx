import Link from "next/link";
import type { Metadata } from "next";
import { getAdminStats, getAuditLogs } from "@/lib/store";
import { getSettings, getMaskedPayoutDetails, gatewayEnvStatus } from "@/lib/settings";
import { formatAmount } from "@/lib/money";
import { formatDateTime } from "@/lib/locale";

export const metadata: Metadata = { title: "لوحة القيادة", robots: { index: false, follow: false } };

export default async function AdminDashboard() {
  const [stats, logs, settings, payout, gateways] = await Promise.all([
    getAdminStats(),
    getAuditLogs(8),
    getSettings(),
    getMaskedPayoutDetails(),
    Promise.resolve(gatewayEnvStatus()),
  ]);
  const maxRevenue = Math.max(1, ...stats.monthly.map((month) => month.revenue));

  const cards = [
    { label: "الإيرادات المؤكدة", value: formatAmount(stats.revenueCents, "USD", "ar"), hint: `${stats.paidOrders} طلب مدفوع` },
    { label: "متوسط قيمة الطلب", value: formatAmount(stats.aovCents, "USD", "ar"), hint: `${stats.customers} عميل مسجل` },
    { label: "طلبات تحتاج متابعة", value: String(stats.pendingOrders), hint: `${stats.openTickets} تذكرة مفتوحة` },
    { label: "مسترجعات", value: formatAmount(stats.refundedCents, "USD", "ar"), hint: `${stats.refundedOrders} طلب مسترجع` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">Owner dashboard</p>
          <h1 className="mt-1 font-display text-3xl text-[#f8f3e6]">لوحة القيادة</h1>
          <p className="mt-1 text-[12px] text-[#9d99ad]">نظرة شاملة على المتجر: الإيرادات، الطلبات، الدعم، وحالة البوابات.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/products" className="btn-gold px-3.5 py-2 text-[11.5px]">
            إضافة منتج
          </Link>
          <Link href="/admin/ai" className="btn-ghost px-3.5 py-2 text-[11.5px]">
            أمر لفريق المدير
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="glass rounded-2xl p-4">
            <p className="text-[10.5px] uppercase tracking-[0.2em] text-[#a99c83]">{card.label}</p>
            <p className="tabular mt-1.5 font-display text-2xl text-[#f0dcae]">{card.value}</p>
            <p className="mt-1 text-[11px] text-[#8f8ba2]">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl text-[#f4efe3]">الإيرادات الشهرية</h2>
            <span className="chip">USD — أساس الحساب</span>
          </div>
          {stats.monthly.length === 0 ? (
            <p className="mt-4 text-[12.5px] text-[#a9a4b8]">لا توجد مبيعات مؤكدة بعد. بعد أول عملية دفع ستظهر الأعمدة هنا.</p>
          ) : (
            <div className="mt-5 flex h-44 items-end gap-2">
              {stats.monthly.map((month) => (
                <div key={month.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="tabular text-[9.5px] text-[#d8c8a2]">{(month.revenue / 100).toFixed(0)}</span>
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-[rgba(217,178,106,0.25)] to-[rgba(240,220,174,0.85)]"
                    style={{ height: `${Math.max(6, (month.revenue / maxRevenue) * 130)}px` }}
                    title={`${month.month}: ${(month.revenue / 100).toFixed(2)} USD`}
                  />
                  <span className="text-[9px] text-[#807c91]">{month.month.slice(2)}</span>
                </div>
              ))}
            </div>
          )}

          <h2 className="mt-6 font-display text-lg text-[#f4efe3]">آخر الطلبات</h2>
          <div className="table-wrap mt-2">
            <table className="w-full text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-[0.16em] text-[#a99c83]">
                <tr>
                  <th className="px-2 py-2 text-start">الطلب</th>
                  <th className="px-2 py-2 text-start">العميل</th>
                  <th className="px-2 py-2 text-start">البوابة</th>
                  <th className="px-2 py-2 text-start">المبلغ</th>
                  <th className="px-2 py-2 text-start">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentOrders.map((order) => (
                  <tr key={order.id} className="border-t border-white/5">
                    <td className="px-2 py-2 font-mono text-[#f0dcae]">{order.orderNumber}</td>
                    <td className="px-2 py-2 text-[#a9a4b8]" dir="ltr">{order.email}</td>
                    <td className="px-2 py-2 text-[#a9a4b8]">{order.paymentProvider}</td>
                    <td className="tabular px-2 py-2 text-[#f4efe3]">{formatAmount(order.totalCents, order.currency, "ar")}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${order.status === "paid" ? "border-emerald-400/30 text-emerald-200" : order.status === "refunded" ? "border-sky-400/30 text-sky-200" : "border-amber-300/30 text-amber-100"}`}>
                        {order.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {stats.recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-4 text-center text-[#807c91]">لا طلبات بعد.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="glass rounded-2xl p-4">
            <h2 className="font-display text-lg text-[#f4efe3]">جاهزية الدفع</h2>
            <ul className="mt-2 space-y-1.5 text-[11.5px] text-[#a9a4b8]">
              <li className="flex justify-between"><span>Stripe</span><span className={gateways.stripe ? "text-emerald-300" : "text-amber-200"}>{gateways.stripe ? "مهيأ" : "بانتظار المفتاح"}</span></li>
              <li className="flex justify-between"><span>Stripe Webhook</span><span className={gateways.stripeWebhook ? "text-emerald-300" : "text-amber-200"}>{gateways.stripeWebhook ? "مهيأ" : "بانتظار السر"}</span></li>
              <li className="flex justify-between"><span>PayPal ({gateways.paypalMode})</span><span className={gateways.paypal ? "text-emerald-300" : "text-amber-200"}>{gateways.paypal ? "مهيأ" : "بانتظار المفاتيح"}</span></li>
              <li className="flex justify-between"><span>البريد (Resend)</span><span className={gateways.email ? "text-emerald-300" : "text-amber-200"}>{gateways.email ? "مهيأ" : "صندوق صادر"}</span></li>
              <li className="flex justify-between"><span>الذكاء اللغوي (LLM)</span><span className={gateways.ai ? "text-emerald-300" : "text-amber-200"}>{gateways.ai ? "مهيأ" : "محرك محلي"}</span></li>
              <li className="flex justify-between"><span>وضع المتجر</span><span className={settings.testMode ? "text-amber-200" : "text-emerald-300"}>{settings.testMode ? "اختبار" : "حقيقي"}</span></li>
            </ul>
            <Link href="/admin/payments" className="btn-ghost mt-3 w-full py-1.5 text-[11px]">إدارة الدفع والحساب</Link>
          </div>

          <div className="glass rounded-2xl p-4">
            <h2 className="font-display text-lg text-[#f4efe3]">الحساب البنكي</h2>
            {payout ? (
              <div className="mt-2 space-y-1 text-[11.5px] text-[#a9a4b8]">
                <p>صاحب الحساب: {payout.accountHolder}</p>
                <p>البنك: {payout.bankName}</p>
                <p dir="ltr">IBAN: {payout.iban}</p>
                <p dir="ltr">SWIFT: {payout.swift}</p>
                <p>{payout.country} · {payout.currency}</p>
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] leading-relaxed text-[#a9a4b8]">
                لم تُدخل بيانات الحساب بعد. أدخلها مرة واحدة لتُخزَّن مشفّرة وتظهر مخفية جزئيًا.
              </p>
            )}
            <Link href="/admin/payments" className="btn-ghost mt-3 w-full py-1.5 text-[11px]">فتح القسم</Link>
          </div>

          <div className="glass rounded-2xl p-4">
            <h2 className="font-display text-lg text-[#f4efe3]">الأكثر مبيعًا</h2>
            <ul className="mt-2 space-y-1.5 text-[11.5px]">
              {stats.topProducts.length === 0 ? (
                <li className="text-[#807c91]">لا مبيعات بعد.</li>
              ) : (
                stats.topProducts.map((entry) => (
                  <li key={entry.product.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-[#c3bece]">{entry.product.title}</span>
                    <span className="tabular text-[#f0dcae]">{entry.sold}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <h2 className="font-display text-lg text-[#f4efe3]">آخر العمليات</h2>
        <div className="table-wrap mt-2">
          <table className="w-full text-[11px]">
            <thead className="text-[9.5px] uppercase tracking-[0.16em] text-[#a99c83]">
              <tr>
                <th className="px-2 py-1.5 text-start">الوقت</th>
                <th className="px-2 py-1.5 text-start">الفاعل</th>
                <th className="px-2 py-1.5 text-start">العملية</th>
                <th className="px-2 py-1.5 text-start">الكيان</th>
                <th className="px-2 py-1.5 text-start">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-white/5 text-[#a9a4b8]">
                  <td className="px-2 py-1.5">{formatDateTime(log.createdAt, "ar")}</td>
                  <td className="px-2 py-1.5" dir="ltr">{log.actor}</td>
                  <td className="px-2 py-1.5 font-mono text-[10.5px] text-[#d8c8a2]">{log.action}</td>
                  <td className="px-2 py-1.5">{log.entity} {log.entityId ? `#${log.entityId}` : ""}</td>
                  <td className="px-2 py-1.5" dir="ltr">{log.ip}</td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center text-[#807c91]">لا عمليات مسجلة بعد.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
