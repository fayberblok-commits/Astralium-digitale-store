import type { Metadata } from "next";
import { getAllAgents } from "@/lib/store";
import { saveAgent, toggleAgent } from "@/app/admin/actions";
import { db } from "@/db";
import { aiConversations } from "@/db/schema";
import { desc } from "drizzle-orm";
import { formatDateTime } from "@/lib/locale";

export const metadata: Metadata = { title: "الموظفون الاصطناعيون", robots: { index: false, follow: false } };

type SearchParams = Promise<{ state?: string }>;

export default async function AdminAgentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const agents = await getAllAgents();
  const conversations = await db.select().from(aiConversations).orderBy(desc(aiConversations.createdAt)).limit(8);
  const teams: { key: "customer" | "manager"; title: string; note: string }[] = [
    { key: "customer", title: "فريق العملاء", note: "يظهر في صفحة «الموظفون الاصطناعيون» ويتحدث مع المشترين في 12 لغة." },
    { key: "manager", title: "فريقي الخاص (المدير)", note: "لا يظهر أبدًا للمشترين. ينفّذ أوامري عبر صفحة فريق المدير الذكي." },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">الموظفون الاصطناعيون</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">فريقان منفصلان تمامًا: فريق للعملاء، وفريق للمدير لا يظهر في أي صفحة عامة.</p>
      </div>

      {params.state ? (
        <div className="rounded-xl border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] px-4 py-2.5 text-[12px] text-[#f0dcae]">
          {params.state === "invalid" ? "أدخل اسم الموظف." : "تم تحديث بيانات الموظف."}
        </div>
      ) : null}

      {teams.map((team) => (
        <section key={team.key} className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-xl text-[#f4efe3]">{team.title}</h2>
              <p className="text-[11.5px] text-[#8f8ba2]">{team.note}</p>
            </div>
            <span className="chip">{agents.filter((agent) => agent.team === team.key).length} موظفًا</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {agents
              .filter((agent) => agent.team === team.key)
              .map((agent) => (
                <details key={agent.id} className="glass rounded-2xl p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(217,178,106,0.35)]" aria-hidden="true">{agent.glyph}</span>
                        <div>
                          <p className="text-[13px] text-[#f2eddf]">{agent.name}</p>
                          <p className="text-[10.5px] text-[#a8a4b8]">{agent.title} · {agent.conversations} محادثة</p>
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[9.5px] ${agent.active ? "border-emerald-400/30 text-emerald-200" : "border-white/15 text-white/60"}`}>
                        {agent.active ? "نشط" : "متوقف"}
                      </span>
                    </div>
                  </summary>
                  <form action={saveAgent} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={agent.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <input name="name" defaultValue={agent.name} className="field text-[11.5px]" placeholder="الاسم" aria-label="الاسم" />
                      <input name="glyph" defaultValue={agent.glyph} maxLength={4} className="field text-center text-[13px]" aria-label="الرمز" />
                    </div>
                    <input name="title" defaultValue={agent.title} className="field text-[11.5px]" placeholder="المسمى" aria-label="المسمى" />
                    <input name="specialty" defaultValue={agent.specialty} className="field text-[11.5px]" placeholder="التخصص" aria-label="التخصص" />
                    <textarea name="greeting" defaultValue={agent.greeting} rows={2} className="field text-[11.5px]" placeholder="التحية بالعربية" aria-label="التحية بالعربية" />
                    <textarea name="greetingEn" defaultValue={agent.greetingEn ?? ""} rows={2} className="field text-[11.5px]" dir="ltr" placeholder="Greeting (English)" aria-label="Greeting English" />
                    <textarea name="instructions" defaultValue={agent.instructions} rows={2} className="field text-[11.5px]" placeholder="تعليمات إضافية (لا تُنشر للعملاء)" aria-label="تعليمات" />
                    {team.key === "manager" ? <input type="hidden" name="team" value="manager" /> : null}
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-[11px] text-[#c3bece]">
                        <input type="checkbox" name="active" defaultChecked={agent.active} className="h-4 w-4" />
                        نشط
                      </label>
                      <button type="submit" className="btn-gold px-3 py-1.5 text-[11px]">حفظ</button>
                    </div>
                  </form>
                  <form action={toggleAgent} className="mt-2">
                    <input type="hidden" name="id" value={agent.id} />
                    <input type="hidden" name="active" value={String(!agent.active)} />
                    <button type="submit" className="text-[10.5px] text-[#a9a4b8] hover:text-[#f0dcae]">{agent.active ? "إيقاف مؤقت" : "إعادة التفعيل"}</button>
                  </form>
                </details>
              ))}
          </div>
        </section>
      ))}

      <section className="glass rounded-2xl p-4">
        <h2 className="font-display text-lg text-[#f4efe3]">إنشاء موظف جديد</h2>
        <form action={saveAgent} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="name" required className="field text-[12px]" placeholder="الاسم" aria-label="الاسم" />
          <input name="title" className="field text-[12px]" placeholder="المسمى (مثال: مستشار مبيعات)" aria-label="المسمى" />
          <input name="specialty" className="field text-[12px]" placeholder="التخصص" aria-label="التخصص" />
          <input name="glyph" maxLength={4} className="field text-center text-[13px]" placeholder="✦" aria-label="الرمز" />
          <textarea name="greeting" rows={2} className="field text-[12px] sm:col-span-2" placeholder="التحية الافتتاحية" aria-label="التحية" />
          <textarea name="greetingEn" rows={2} className="field text-[12px] sm:col-span-2" dir="ltr" placeholder="Opening greeting in English" aria-label="Greeting English" />
          <select name="team" className="field text-[12px]" aria-label="الفريق">
            <option value="customer">فريق العملاء (يظهر للمشترين)</option>
            <option value="manager">فريق المدير (خاص بي فقط)</option>
          </select>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-[11px] text-[#c3bece]">
              <input type="checkbox" name="active" defaultChecked className="h-4 w-4" />
              نشط
            </label>
            <button type="submit" className="btn-gold px-3 py-2 text-[11.5px]">إنشاء</button>
          </div>
        </form>
      </section>

      <section className="glass rounded-2xl p-4">
        <h2 className="font-display text-lg text-[#f4efe3]">آخر محادثات العملاء</h2>
        <div className="mt-2 space-y-2">
          {conversations.map((conversation) => (
            <details key={conversation.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <summary className="cursor-pointer text-[11.5px] text-[#d8c8a2]">
                {conversation.agentSlug} · {formatDateTime(conversation.createdAt, "ar")} {conversation.escalated ? "· تم التحويل للدعم" : ""}
              </summary>
              <div className="mt-2 space-y-1 text-[11px] text-[#a9a4b8]">
                {conversation.transcript.slice(-6).map((message, index) => (
                  <p key={index} className={message.role === "user" ? "text-[#c3bece]" : "text-[#8f8ba2]"}>
                    <span className="font-mono text-[9.5px] uppercase">{message.role}</span>: {message.content.slice(0, 220)}
                  </p>
                ))}
              </div>
            </details>
          ))}
          {conversations.length === 0 ? <p className="text-[11.5px] text-[#807c91]">لا محادثات مسجلة بعد.</p> : null}
        </div>
      </section>
    </div>
  );
}
