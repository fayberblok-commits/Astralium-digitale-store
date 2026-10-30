import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { refundOrderAction } from "@/app/admin/actions";
import { formatDateTime } from "@/lib/locale";
import { formatAmount } from "@/lib/money";

export const metadata: Metadata = { title: "الطلبات", robots: { index: false, follow: false } };

type SearchParams = Promise<{ q?: string; status?: string; state?: string; message?: string }>;

const STATUSES = ["all", "paid", "pending", "failed", "refunded", "cancelled"];

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const status = params.status && STATUSES.includes(params.status) ? params.status : "all";
  const conditions: SQL[] = [];
  if (q) {
    const search = or(ilike(orders.orderNumber, `%${q}%`), ilike(orders.email, `%${q}%`), ilike(orders.name, `%${q}%`));
    if (search) conditions.push(search);
  }
  if (status !== "all") conditions.push(eq(orders.status, status));
  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(80);
  const items = rows.length
    ? await db.select().from(orderItems).where(or(...rows.map((row) => eq(orderItems.orderId, row.id))))
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">الطلبات</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">كل طلب، حالته، بيانات المشتري، والاسترجاع — من مكتب المدير فقط.</p>
      </div>

      {params.state === "refunded" ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[12px] text-emerald-100">تم تنفيذ الاسترجاع وإلغاء صلاحية روابط التحميل.</div>
      ) : null}
      {params.state === "refund_failed" ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-[12px] text-rose-100">{params.message ?? "تعذّر الاسترجاع."}</div>
      ) : null}

      <form action="/admin/orders" className="glass flex flex-wrap items-end gap-2 rounded-2xl p-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="oq" className="mb-1 block text-[10.5px] text-[#a99c83]">بحث برقم الطلب أو البريد أو الاسم</label>
          <input id="oq" name="q" defaultValue={q} className="field text-[12px]" placeholder="AST-4F2A1C" />
        </div>
        <div>
          <label htmlFor="os" className="mb-1 block text-[10.5px] text-[#a99c83]">الحالة</label>
          <select id="os" name="status" defaultValue={status} className="field text-[12px]">
            {STATUSES.map((value) => (
              <option key={value} value={value}>{value === "all" ? "الكل" : value}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-gold px-4 py-2 text-[11.5px]">تصفية</button>
        <Link href="/admin/orders" className="btn-ghost px-3 py-2 text-[11px]">إعادة ضبط</Link>
      </form>

      <div className="glass rounded-2xl p-3">
        <div className="table-wrap">
          <table className="w-full text-[11.5px]">
            <thead className="text-[9.5px] uppercase tracking-[0.16em] text-[#a99c83]">
              <tr>
                <th className="px-2 py-2 text-start">الطلب</th>
                <th className="px-2 py-2 text-start">التاريخ</th>
                <th className="px-2 py-2 text-start">العميل</th>
                <th className="px-2 py-2 text-start">المنتجات</th>
                <th className="px-2 py-2 text-start">المبلغ</th>
                <th className="px-2 py-2 text-start">البوابة</th>
                <th className="px-2 py-2 text-start">الحالة</th>
                <th className="px-2 py-2 text-start">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => {
                const orderProducts = items.filter((item) => item.orderId === order.id);
                return (
                  <tr key={order.id} className="border-t border-white/5">
                    <td className="px-2 py-2 font-mono text-[#f0dcae]">{order.orderNumber}</td>
                    <td className="px-2 py-2 text-[#a9a4b8]">{formatDateTime(order.createdAt, "ar")}</td>
                    <td className="px-2 py-2 text-[#c3bece]">
                      <span className="block">{order.name}</span>
                      <span className="block text-[10px] text-[#807c91]" dir="ltr">{order.email}</span>
                    </td>
                    <td className="px-2 py-2 text-[#a9a4b8]">{orderProducts.map((item) => item.titleSnapshot).join(", ") || "—"}</td>
                    <td className="tabular px-2 py-2 text-[#f4efe3]">
                      {formatAmount(order.totalCents, order.currency, "ar")}
                      <span className="block text-[9.5px] text-[#807c91]">{(order.baseTotalCents / 100).toFixed(2)} USD</span>
                    </td>
                    <td className="px-2 py-2 text-[#a9a4b8]">{order.paymentProvider}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[9.5px] ${order.status === "paid" ? "border-emerald-400/30 text-emerald-200" : order.status === "refunded" ? "border-sky-400/30 text-sky-200" : order.status === "failed" ? "border-rose-400/30 text-rose-200" : "border-amber-300/30 text-amber-100"}`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={`/invoice/${order.orderNumber}?at=${encodeURIComponent(order.accessToken)}`} target="_blank" className="text-[10.5px] text-[#e6d6ae] hover:underline">
                          فاتورة
                        </Link>
                        {order.status === "paid" ? (
                          <form action={refundOrderAction}>
                            <input type="hidden" name="orderNumber" value={order.orderNumber} />
                            <button type="submit" className="rounded-full border border-rose-300/30 px-2 py-0.5 text-[10px] text-rose-200 hover:bg-rose-400/10">
                              استرجاع
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-[#807c91]">لا طلبات مطابقة.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10.5px] text-[#807c91]">الاسترجاع يُنفَّذ عبر البوابة إن كانت مهيأة، ويُسجَّل في سجل العمليات ويُلغي روابط التحميل.</p>
    </div>
  );
}
