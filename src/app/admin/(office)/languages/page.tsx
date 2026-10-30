import type { Metadata } from "next";
import Link from "next/link";
import { saveSiteContent } from "@/app/admin/actions";
import { LOCALES } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "اللغات", robots: { index: false, follow: false } };

type SearchParams = Promise<{ state?: string }>;

export default async function AdminLanguagesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const settings = await getSettings();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">اللغات</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">12 لغة مدعومة بالكامل في واجهة المتجر، مع اكتشاف تلقائي للغة الزائر واتجاه RTL للعربية.</p>
      </div>

      {params.state === "saved" ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[12px] text-emerald-100">تم حفظ إعدادات اللغات، ومنع تحديث لغة الزائر المختارة.</div>
      ) : null}

      <form action={saveSiteContent} className="glass rounded-2xl p-4">
        <input type="hidden" name="redirectTo" value="languages" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {LOCALES.map((locale) => (
            <label key={locale.code} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[12px] text-[#e9e4d8]">
              <span>
                <span className="block">{locale.label}</span>
                <span className="block text-[10px] text-[#8f8ba2]" dir="ltr">{locale.english} · {locale.dir.toUpperCase()} · {locale.currency}</span>
              </span>
              <input type="checkbox" name={`locale_${locale.code}`} defaultChecked={settings.enabledLocales.includes(locale.code)} className="h-4 w-4" />
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="d-default" className="mb-1 block text-[10.5px] text-[#a99c83]">اللغة الافتراضية</label>
            <select id="d-default" name="defaultLocale" defaultValue={settings.defaultLocale} className="field text-[12px]">
              {LOCALES.map((locale) => (
                <option key={locale.code} value={locale.code}>{locale.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-gold w-full">حفظ اللغات</button>
          </div>
        </div>
        <p className="mt-3 text-[10.5px] leading-relaxed text-[#807c91]">
          المحتوى التحريري (أوصاف المنتجات، المقالات، الصفحات القانونية) يُكتب بالعربية والإنجليزية؛ ولغات الواجهة الأخرى تُرجمت لعناصر التنقل والواجهة الأساسية وتُكمل بالإنجليزية عند غياب الترجمة. يمكنك إضافة ترجمة أي منتج من صفحة المنتجات (حقول EN).
        </p>
      </form>

      <div className="glass rounded-2xl p-4 text-[11.5px] leading-relaxed text-[#a9a4b8]">
        <p className="font-display text-base text-[#f0dcae]">ملاحظات التنفيذ</p>
        <ul className="mt-2 space-y-1.5">
          <li>• تبديل اللغة يتم من شريط التنقل ويُخزَّن في كوكي، ويُطبَّق فورًا مع تغيير الاتجاه.</li>
          <li>• الزائر الجديد تُكتشف لغته من ترويسة المتصفح Accept-Language.</li>
          <li>• الموظفون الاصطناعيون يردّون بلغة رسالة العميل تلقائيًا (كشف نصي) بغض النظر عن لغة الواجهة.</li>
          <li>• صفحة العروض، الدعم، والحساب تُستخدم فيها نفس لغة الواجهة المختارة.</li>
        </ul>
        <Link href="/" target="_blank" className="btn-ghost mt-3 inline-flex px-3 py-1.5 text-[11px]">تجربة التبديل في المتجر ↗</Link>
      </div>
    </div>
  );
}
