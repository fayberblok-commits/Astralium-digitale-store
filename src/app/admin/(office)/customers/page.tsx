import type { Metadata } from "next";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { formatDate } from "@/lib/locale";
import { formatAmount } from "@/lib/money";

export const metadata: Metadata = { title: "العملاء", robots: { index: false, follow: false } };

type SearchParams = Promise<{ q?: string }>;

export default async function AdminCustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const rows = await db
    .select()
    .from(customers)
    .where(q ? or(ilike(customers.email, `%${q}%`), ilike(customers.name, `%${q}%`)) : undefined)
    .orderBy(desc(customers.createdAt))
    .limit(100);

  const spend = await db
    .select({
      customerId: orders.customerId,
      email: orders.email,
      paidTotal: sql<number>`coalesce(sum(case when ${orders.status} = 'paid' then ${orders.baseTotalCents} else 0 end), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(orders)
    .groupBy(orders.customerId, orders.email);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">العملاء</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">بيانات العملاء وقيمة مشترياتهم — للعرض داخل مكتب المدير فقط، ولا تُستخدم في أي تواصل خارجي.</p>
      </div>

      <form action="/admin/customers" className="glass flex flex-wrap items-end gap-2 rounded-2xl p-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="cq" className="mb-1 block text-[10.5px] text-[#a99c83]">بحث بالاسم أو البريد</label>
          <input id="cq" name="q" defaultValue={q} className="field text-[12px]" />
        </div>
        <button type="submit" className="btn-gold px-4 py-2 text-[11.5px]">بحث</button>
      </form>

      <div className="glass rounded-2xl p-3">
        <div className="table-wrap">
          <table className="w-full text-[11.5px]">
            <thead className="text-[9.5px] uppercase tracking-[0.16em] text-[#a99c83]">
              <tr>
                <th className="px-2 py-2 text-start">الاسم</th>
                <th className="px-2 py-2 text-start">البريد</th>
                <th className="px-2 py-2 text-start">الدولة</th>
                <th className="px-2 py-2 text-start">اللغة</th>
                <th className="px-2 py-2 text-start">الطلبات</th>
                <th className="px-2 py-2 text-start">إجمالي مدفوع</th>
                <th className="px-2 py-2 text-start">رمز الإحالة</th>
                <th className="px-2 py-2 text-start">تاريخ التسجيل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => {
                const stats = spend.find((entry) => entry.customerId === customer.id || entry.email === customer.email);
                return (
                  <tr key={customer.id} className="border-t border-white/5">
                    <td className="px-2 py-2 text-[#f0ecdf]">{customer.name}</td>
                    <td className="px-2 py-2 text-[#a9a4b8]" dir="ltr">{customer.email}</td>
                    <td className="px-2 py-2 text-[#a9a4b8]">{customer.country ?? "—"}</td>
                    <td className="px-2 py-2 text-[#a9a4b8]">{customer.locale}</td>
                    <td className="tabular px-2 py-2 text-[#a9a4b8]">{stats?.orderCount ?? 0}</td>
                    <td className="tabular px-2 py-2 text-[#d8c8a2]">{formatAmount(stats?.paidTotal ?? 0, "USD", "ar")}</td>
                    <td className="px-2 py-2 font-mono text-[10.5px] text-[#d8c8a2]">{customer.referralCode}</td>
                    <td className="px-2 py-2 text-[#807c91]">{formatDate(customer.createdAt, "ar")}</td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-[#807c91]">لا عملاء مطابقين.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10.5px] text-[#807c91]">ملاحظة حماية: لا تُخزَّن أي بيانات بطاقات. كلمات المرور مخزّنة scrypt ولا يمكن قراءتها.</p>
    </div>
  );
}
