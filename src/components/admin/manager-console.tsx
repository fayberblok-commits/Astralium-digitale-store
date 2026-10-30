"use client";

import { useRef, useState, useTransition } from "react";
import { runManagerCommand } from "@/app/admin/actions";

type Entry = { role: "owner" | "assistant"; text: string; actions?: string[] };

const QUICK = [
  "تحليل المبيعات",
  "راقب المدفوعات",
  "راجع تذاكر الدعم",
  "أضف منتج «دفتر استراتيجيات النمو» بسعر 49",
  "أنشئ كوبون ASTRAL20 بنسبة 20",
  "اكتب إعلان لـ«دليل الإنتاجية العميقة»",
  "اقترح تحسينات تصميم",
];

export function ManagerConsole({ ownerName }: { ownerName: string }) {
  const [entries, setEntries] = useState<Entry[]>([
    {
      role: "assistant",
      text: `مرحبًا ${ownerName}. أنا فريقك الإداري. أنفّذ أوامرك على المتجر: المنتجات والأسعار، الكوبونات، تحليل المبيعات، مراقبة المدفوعات، مراجعة التذاكر، المحتوى والإعلانات، وملاحظات التصميم. كل تنفيذ يُسجَّل في سجل العمليات، والأوامر لا تُقبل إلا من جلستك.`,
      actions: ["جاهز للأوامر"],
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const scroller = useRef<HTMLDivElement | null>(null);

  function send(command: string) {
    const text = command.trim();
    if (!text || pending) return;
    setEntries((prev) => [...prev, { role: "owner", text }]);
    setInput("");
    startTransition(async () => {
      try {
        const result = await runManagerCommand(text);
        setEntries((prev) => [...prev, { role: "assistant", text: result.reply, actions: result.actions }]);
      } catch {
        setEntries((prev) => [...prev, { role: "assistant", text: "تعذّر تنفيذ الأمر. تحقق من الصلاحية أو أعد صياغة الأمر." }]);
      } finally {
        setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }), 60);
      }
    });
  }

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="font-display text-lg text-[#f4efe3]">فريق المدير الذكي</p>
          <p className="text-[10.5px] text-[#9ed3b3]">
            <span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> جلسة مالك موثّقة · كل عملية مسجلة
          </p>
        </div>
        <span className="chip">OWNER ONLY</span>
      </div>

      <div ref={scroller} className="max-h-[420px] space-y-3 overflow-y-auto px-4 py-4">
        {entries.map((entry, index) => (
          <div key={index} className={`max-w-[92%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed ${entry.role === "owner" ? "ms-auto rounded-se-sm bg-[#e9d3a1] text-[#171208]" : "rounded-ss-sm border border-white/10 bg-white/[0.04] text-[#e9e4d8]"}`}>
            {entry.text}
            {entry.actions && entry.actions.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.actions.map((action) => (
                  <span key={action} className="rounded-full border border-[rgba(217,178,106,0.25)] bg-[rgba(217,178,106,0.08)] px-2 py-0.5 text-[9.5px] text-[#e9d7ad]">
                    {action}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {pending ? <div className="max-w-[60%] rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[11.5px] text-[#a8a4b8]">جارٍ التنفيذ على قاعدة البيانات…</div> : null}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-white/10 px-3 pt-2.5">
        {QUICK.map((command) => (
          <button
            key={command}
            type="button"
            onClick={() => send(command)}
            disabled={pending}
            className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] text-[#c9c4d4] hover:border-[rgba(217,178,106,0.4)] hover:text-[#f0dcae] disabled:opacity-50"
          >
            {command}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 p-3"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="اكتب أمرًا تنفيذيًا… مثال: غيّر سعر «دليل الإنتاجية» إلى 29"
          rows={2}
          className="field text-[12px]"
          aria-label="أمر للمدير"
        />
        <button type="submit" disabled={pending || !input.trim()} className="btn-gold px-4 py-2 text-[11.5px] disabled:opacity-50">
          تنفيذ
        </button>
      </form>
      <p className="border-t border-white/10 px-4 py-2 text-[10px] leading-relaxed text-[#807c91]">
        حماية: لا يطبع الفريق أي IBAN أو مفاتيح سرية في المحادثة، ويطلب تأكيدًا بصيغة واضحة قبل التعديلات الجماعية. الأوامر تُنفَّذ تحت هوية جلستك وتُسجَّل بالكامل.
      </p>
    </div>
  );
}
