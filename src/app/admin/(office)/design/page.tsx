import type { Metadata } from "next";
import { saveSiteContent } from "@/app/admin/actions";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "التصميم والمحتوى", robots: { index: false, follow: false } };

type SearchParams = Promise<{ state?: string }>;

export default async function AdminDesignPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const settings = await getSettings();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">التصميم والمحتوى</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">تحكّم في نصوص الواجهة، الهوية اللونية، معلومات التواصل، والضريبة — بالعربية والإنجليزية.</p>
      </div>

      {params.state === "saved" ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-[12px] text-emerald-100">تم حفظ التغييرات وتحديث المتجر فورًا.</div>
      ) : null}

      <form action={saveSiteContent} className="grid gap-4 xl:grid-cols-2">
        <input type="hidden" name="redirectTo" value="design" />
        <section className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">الواجهة الرئيسية</h2>
          <div className="mt-3 space-y-2.5">
            <input name="heroTitleAr" defaultValue={settings.heroTitleAr} className="field text-[12px]" placeholder="عنوان الواجهة بالعربية" aria-label="عنوان الواجهة بالعربية" />
            <input name="heroTitleEn" defaultValue={settings.heroTitleEn} className="field text-[12px]" dir="ltr" placeholder="Hero title (EN)" aria-label="Hero title" />
            <textarea name="heroSubtitleAr" defaultValue={settings.heroSubtitleAr} rows={3} className="field text-[12px]" placeholder="وصف الواجهة بالعربية" aria-label="وصف الواجهة" />
            <textarea name="heroSubtitleEn" defaultValue={settings.heroSubtitleEn} rows={3} className="field text-[12px]" dir="ltr" placeholder="Hero subtitle (EN)" aria-label="Hero subtitle" />
            <input name="announcementAr" defaultValue={settings.announcementAr} className="field text-[12px]" placeholder="شريط الإعلان بالعربية" aria-label="شريط الإعلان" />
            <input name="announcementEn" defaultValue={settings.announcementEn} className="field text-[12px]" dir="ltr" placeholder="Announcement (EN)" aria-label="Announcement" />
            <textarea name="aboutAr" defaultValue={settings.aboutAr} rows={4} className="field text-[12px]" placeholder="نبذة عن المتجر" aria-label="نبذة" />
            <textarea name="aboutEn" defaultValue={settings.aboutEn} rows={4} className="field text-[12px]" dir="ltr" placeholder="About (EN)" aria-label="About" />
          </div>
        </section>

        <section className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">الهوية والتواصل</h2>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="d-accent" className="mb-1 block text-[10.5px] text-[#a99c83]">اللون الذهبي الأساسي</label>
              <input id="d-accent" name="accent" defaultValue={settings.accent} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-hero" className="mb-1 block text-[10.5px] text-[#a99c83]">مسار صورة الواجهة</label>
              <input id="d-hero" name="heroImage" defaultValue={settings.heroImage} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-mail" className="mb-1 block text-[10.5px] text-[#a99c83]">بريد الدعم</label>
              <input id="d-mail" name="supportEmail" type="email" defaultValue={settings.supportEmail} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-wa" className="mb-1 block text-[10.5px] text-[#a99c83]">واتساب الدعم</label>
              <input id="d-wa" name="whatsapp" defaultValue={settings.whatsapp} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-ig" className="mb-1 block text-[10.5px] text-[#a99c83]">Instagram</label>
              <input id="d-ig" name="instagram" defaultValue={settings.instagram} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-x" className="mb-1 block text-[10.5px] text-[#a99c83]">X</label>
              <input id="d-x" name="x" defaultValue={settings.x} className="field text-[12px]" dir="ltr" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="d-li" className="mb-1 block text-[10.5px] text-[#a99c83]">LinkedIn</label>
              <input id="d-li" name="linkedin" defaultValue={settings.linkedin} className="field text-[12px]" dir="ltr" />
            </div>
          </div>

          <h2 className="mt-5 font-display text-lg text-[#f4efe3]">الضرائب والفواتير</h2>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="d-tax" className="mb-1 block text-[10.5px] text-[#a99c83]">نسبة الضريبة %</label>
              <input id="d-tax" name="taxPercent" type="number" min="0" max="30" step="0.1" defaultValue={settings.taxPercent} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-refund" className="mb-1 block text-[10.5px] text-[#a99c83]">مدة الاسترجاع (أيام)</label>
              <input id="d-refund" name="refundWindowDays" type="number" min="0" max="90" defaultValue={settings.refundWindowDays} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-tax-ar" className="mb-1 block text-[10.5px] text-[#a99c83]">اسم الضريبة (عربي)</label>
              <input id="d-tax-ar" name="taxLabelAr" defaultValue={settings.taxLabelAr} className="field text-[12px]" />
            </div>
            <div>
              <label htmlFor="d-tax-en" className="mb-1 block text-[10.5px] text-[#a99c83]">اسم الضريبة (إنجليزي)</label>
              <input id="d-tax-en" name="taxLabelEn" defaultValue={settings.taxLabelEn} className="field text-[12px]" dir="ltr" />
            </div>
            <div>
              <label htmlFor="d-prefix" className="mb-1 block text-[10.5px] text-[#a99c83]">بادئة الفاتورة</label>
              <input id="d-prefix" name="invoicePrefix" defaultValue={settings.invoicePrefix} className="field text-[12px]" dir="ltr" />
            </div>
          </div>

          <button type="submit" className="btn-gold mt-5 w-full">حفظ كل إعدادات التصميم</button>
        </section>
      </form>
    </div>
  );
}
