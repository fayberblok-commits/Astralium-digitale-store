import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiAgents, auditLogs, orders, products, tickets } from "@/db/schema";
import { ManagerConsole } from "@/components/admin/manager-console";
import { requireOwner } from "@/lib/auth";
import { formatDateTime } from "@/lib/locale";
import { formatAmount } from "@/lib/money";
import { gatewayEnvStatus } from "@/lib/settings";

export const metadata: Metadata = { title: "فريق المدير الذكي", robots: { index: false, follow: false } };

export default async function AdminAiPage() {
  const admin = await requireOwner();
  const managerAgents = await db.select().from(aiAgents).where(eq(aiAgents.team, "manager")).orderBy(aiAgents.sortOrder);
  const recentActions = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(16);
  const [revenue] = await db
    .select({ sum: sql<number>`coalesce(sum(${orders.baseTotalCents}),0)::int`, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.status, "paid"));
  const [productCount] = await db.select({ count: sql<number>`count(*)::int` }).from(products);
  const [openTickets] = await db.select({ count: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.status, "open"));
  const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.status, "pending"), gte(orders.createdAt, new Date(Date.now() - 7 * 864e5))));
  const env = gatewayEnvStatus();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-[#f8f3e6]">فريق المدير الذكي</h1>
          <p className="mt-1 text-[12px] text-[#9d99ad]">موظفون اصطناعيون تابعون للمالك فقط — لا يظهرون في المتجر ولا يستجيبون لغير جلستك.</p>
        </div>
        <Link href="/admin/agents" className="btn-ghost px-3.5 py-2 text-[11.5px]">إدارة تعريفات الفريق</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "إيرادات مؤكدة", value: formatAmount(revenue?.sum ?? 0, "USD", "ar") },
          { label: "منتجات في الكتالوج", value: String(productCount?.count ?? 0) },
          { label: "تذاكر مفتوحة", value: String(openTickets?.count ?? 0) },
          { label: "طلبات معلّقة (7 أيام)", value: String(pending?.count ?? 0) },
        ].map((card) => (
          <div key={card.label} className="glass rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#a99c83]">{card.label}</p>
            <p className="tabular mt-1 font-display text-xl text-[#f0dcae]">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <ManagerConsole ownerName={admin.name} />

        <div className="space-y-3">
          <div className="glass rounded-2xl p-4">
            <h2 className="font-display text-lg text-[#f4efe3]">تعريفات فريقي</h2>
            <ul className="mt-2 space-y-2">
              {managerAgents.map((agent) => (
                <li key={agent.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                  <p className="text-[12px] text-[#f2eddf]">{agent.glyph} {agent.name}</p>
                  <p className="text-[10.5px] text-[#a8a4b8]">{agent.title}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-[#8f8ba2]">{agent.specialty}</p>
                </li>
              ))}
              {managerAgents.length === 0 ? <li className="text-[11.5px] text-[#807c91]">لا تعريفات بعد — أضفها من صفحة الموظفين.</li> : null}
            </ul>
          </div>

          <div className="glass rounded-2xl p-4 text-[10.5px] leading-relaxed text-[#a9a4b8]">
            <h2 className="font-display text-base text-[#f0dcae]">حدود الصلاحية</h2>
            <ul className="mt-2 space-y-1.5">
              <li>• الأوامر تُقبل فقط من جلسة المالك المصادق عليها بـ 2FA.</li>
              <li>• لا تُطبع المفاتيح أو بيانات البنك أو كلمات المرور في المحادثة.</li>
              <li>• الحذف محمي: المنتجات المرتبطة بطلبات تُؤرشف بدل الحذف.</li>
              <li>• كل تنفيذ يُسجَّل في سجل العمليات مع IP والوقت.</li>
              <li>• البوابات: {env.stripe ? "Stripe مهيأ" : "Stripe بانتظار المفتاح"} · {env.paypal ? "PayPal مهيأ" : "PayPal بانتظار المفاتيح"}.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <h2 className="font-display text-lg text-[#f4efe3]">عمليات فريق المدير</h2>
        <div className="mt-2 space-y-1.5 text-[10.5px]">
          {recentActions.map((action) => (
            <div key={action.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
              <span className="font-mono text-[10px] text-[#d8c8a2]">{action.action}</span>
              <span className="text-[#8f8ba2]">{formatDateTime(action.createdAt, "ar")} · {action.entity}{action.entityId ? ` #${action.entityId}` : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
