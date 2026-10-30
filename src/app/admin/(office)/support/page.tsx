import type { Metadata } from "next";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contactMessages, ticketMessages, tickets } from "@/db/schema";
import { closeTicket, markContactHandled, replyTicket } from "@/app/admin/actions";
import { formatDateTime } from "@/lib/locale";

export const metadata: Metadata = { title: "الدعم والتذاكر", robots: { index: false, follow: false } };

type SearchParams = Promise<{ state?: string }>;

export default async function AdminSupportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const ticketRows = await db.select().from(tickets).orderBy(desc(tickets.createdAt)).limit(40);
  const messages = ticketRows.length
    ? await db.select().from(ticketMessages).where(inArray(ticketMessages.ticketId, ticketRows.map((ticket) => ticket.id))).orderBy(ticketMessages.createdAt)
    : [];
  const contacts = await db.select().from(contactMessages).orderBy(desc(contactMessages.createdAt)).limit(20);
  const openCount = ticketRows.filter((ticket) => ticket.status !== "closed").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">الدعم والتذاكر</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">
          {openCount} تذكرة تحتاج متابعة · {contacts.filter((message) => !message.handled).length} رسالة اتصال غير معالجة
        </p>
      </div>

      {params.state ? (
        <div className="rounded-xl border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] px-4 py-2.5 text-[12px] text-[#f0dcae]">
          {params.state === "replied" ? "تم حفظ الرد وإشعار العميل بالبريد." : params.state === "closed" ? "تم إغلاق التذكرة." : params.state === "handled" ? "تم تعليم الرسالة كمعالجة." : "تحقق من المدخلات."}
        </div>
      ) : null}

      <div className="space-y-3">
        {ticketRows.map((ticket) => {
          const ticketThread = messages.filter((message) => message.ticketId === ticket.id);
          return (
            <details key={ticket.id} className="glass rounded-2xl p-4">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11.5px] text-[#f0dcae]">{ticket.ticketNumber}</p>
                    <p className="text-[13px] text-[#f2eddf]">{ticket.subject}</p>
                    <p className="text-[10.5px] text-[#8f8ba2]">
                      {ticket.name} · {ticket.email} {ticket.orderNumber ? `· ${ticket.orderNumber}` : ""} · {formatDateTime(ticket.createdAt, "ar")}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[9.5px] ${ticket.status === "closed" ? "border-white/15 text-white/60" : ticket.status === "answered" ? "border-sky-400/30 text-sky-200" : "border-amber-300/30 text-amber-100"}`}>
                    {ticket.status}
                  </span>
                </div>
              </summary>
              <div className="mt-3 space-y-2">
                {ticketThread.map((message) => (
                  <div key={message.id} className={`rounded-xl px-3 py-2 text-[11.5px] ${message.author === "customer" ? "border border-white/10 bg-white/[0.02] text-[#c3bece]" : "border border-[rgba(217,178,106,0.25)] bg-[rgba(217,178,106,0.06)] text-[#e9d7ad]"}`}>
                    <p className="mb-1 text-[9.5px] uppercase tracking-[0.16em] text-[#8f8ba2]">{message.author} · {formatDateTime(message.createdAt, "ar")}</p>
                    <p className="whitespace-pre-line leading-relaxed">{message.body}</p>
                  </div>
                ))}
                <form action={replyTicket} className="space-y-2">
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <textarea name="message" required minLength={2} rows={3} className="field text-[11.5px]" placeholder="اكتب ردك ليصل إلى بريد العميل…" aria-label="الرد" />
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="submit" className="btn-gold px-3.5 py-1.5 text-[11px]">إرسال الرد</button>
                  </div>
                </form>
                {ticket.status !== "closed" ? (
                  <form action={closeTicket}>
                    <input type="hidden" name="ticketId" value={ticket.id} />
                    <button type="submit" className="text-[10.5px] text-[#a9a4b8] hover:text-[#f0dcae]">إغلاق التذكرة</button>
                  </form>
                ) : null}
              </div>
            </details>
          );
        })}
        {ticketRows.length === 0 ? <div className="glass rounded-2xl p-6 text-center text-[12px] text-[#807c91]">لا تذاكر دعم بعد.</div> : null}
      </div>

      <section id="messages" className="glass rounded-2xl p-4">
        <h2 className="font-display text-lg text-[#f4efe3]">رسائل صفحة الاتصال</h2>
        <div className="mt-2 space-y-2">
          {contacts.map((message) => (
            <div key={message.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] text-[#f0ecdf]">{message.subject}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] ${message.handled ? "border-emerald-400/30 text-emerald-200" : "border-amber-300/30 text-amber-100"}`}>{message.handled ? "معالجة" : "جديدة"}</span>
              </div>
              <p className="mt-1 text-[10.5px] text-[#8f8ba2]" dir="ltr">{message.name} · {message.email} · {formatDateTime(message.createdAt, "ar")}</p>
              <p className="mt-1.5 whitespace-pre-line text-[11.5px] leading-relaxed text-[#a9a4b8]">{message.message}</p>
              {!message.handled ? (
                <form action={markContactHandled} className="mt-2">
                  <input type="hidden" name="id" value={message.id} />
                  <button type="submit" className="text-[10.5px] text-[#e6d6ae] hover:underline">تعليم كمعالجة</button>
                </form>
              ) : null}
            </div>
          ))}
          {contacts.length === 0 ? <p className="text-[11.5px] text-[#807c91]">لا رسائل اتصال.</p> : null}
        </div>
      </section>
    </div>
  );
}
