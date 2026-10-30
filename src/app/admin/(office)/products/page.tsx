import Link from "next/link";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { deleteProduct, saveProduct } from "@/app/admin/actions";
import { CATEGORIES } from "@/lib/i18n";
import { formatAmount } from "@/lib/money";

export const metadata: Metadata = { title: "المنتجات", robots: { index: false, follow: false } };

type SearchParams = Promise<{ edit?: string; state?: string }>;

const COVER_STYLES = [
  { value: "nebula", label: "سديم بنفسجي" },
  { value: "gold", label: "ذهبي ملكي" },
  { value: "emerald", label: "زمردي" },
  { value: "violet", label: "بنفسجي عميق" },
  { value: "solar", label: "شمسي" },
  { value: "ocean", label: "محيطي" },
  { value: "ivory", label: "عاجي" },
];

export default async function AdminProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const all = await db.select().from(products).orderBy(desc(products.updatedAt));
  const editing = params.edit ? all.find((product) => product.id === Number(params.edit)) : undefined;

  const notices: Record<string, string> = {
    saved: "تم حفظ المنتج بنجاح.",
    deleted: "تم حذف المنتج.",
    archived: "المنتج مرتبط بطلبات سابقة، لذلك تم أرشفته (مسودة) بدل حذفه للحفاظ على الفواتير.",
    title_required: "اسم المنتج مطلوب.",
    file_too_large: "حجم الملف أكبر من 30 ميجابايت.",
    missing: "طلب غير صالح.",
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-[#f8f3e6]">المنتجات</h1>
          <p className="mt-1 text-[12px] text-[#9d99ad]">أضف إصداراتك، ارفع الملفات، وحدّد الأسعار والترخيص. لا نضيف أي منتج من طرفنا.</p>
        </div>
        <Link href="/admin/products" className="btn-ghost px-3.5 py-2 text-[11.5px]">منتج جديد</Link>
      </div>

      {params.state && notices[params.state] ? (
        <div className="rounded-xl border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] px-4 py-2.5 text-[12px] text-[#f0dcae]">{notices[params.state]}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
        <form action={saveProduct} encType="multipart/form-data" className="glass rounded-2xl p-4">
          <input type="hidden" name="id" value={editing?.id ?? 0} />
          <h2 className="font-display text-lg text-[#f4efe3]">{editing ? `تعديل: ${editing.title}` : "إضافة منتج جديد"}</h2>
          <div className="mt-3 space-y-2.5">
            <div>
              <label htmlFor="p-title" className="mb-1 block text-[10.5px] text-[#a99c83]">الاسم بالعربية *</label>
              <input id="p-title" name="title" required defaultValue={editing?.title ?? ""} className="field text-[12px]" placeholder="دليل الإنتاجية العميقة" />
            </div>
            <div>
              <label htmlFor="p-title-en" className="mb-1 block text-[10.5px] text-[#a99c83]">الاسم بالإنجليزية</label>
              <input id="p-title-en" name="titleEn" defaultValue={editing?.titleEn ?? ""} className="field text-[12px]" dir="ltr" placeholder="The Deep Focus Playbook" />
            </div>
            <div>
              <label htmlFor="p-subtitle" className="mb-1 block text-[10.5px] text-[#a99c83]">الوصف المختصر (عربي)</label>
              <input id="p-subtitle" name="subtitle" defaultValue={editing?.subtitle ?? ""} className="field text-[12px]" placeholder="نظام عملي للتركيز العميق في 21 يومًا" />
            </div>
            <div>
              <label htmlFor="p-subtitle-en" className="mb-1 block text-[10.5px] text-[#a99c83]">الوصف المختصر (إنجليزي)</label>
              <input id="p-subtitle-en" name="subtitleEn" defaultValue={editing?.subtitleEn ?? ""} className="field text-[12px]" dir="ltr" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="p-price" className="mb-1 block text-[10.5px] text-[#a99c83]">السعر (USD) *</label>
                <input id="p-price" name="price" type="number" min="0" step="0.01" required defaultValue={editing ? (editing.priceCents / 100).toFixed(2) : "29.00"} className="field text-[12px]" dir="ltr" />
              </div>
              <div>
                <label htmlFor="p-compare" className="mb-1 block text-[10.5px] text-[#a99c83]">السعر قبل الخصم</label>
                <input id="p-compare" name="compareAt" type="number" min="0" step="0.01" defaultValue={editing?.compareAtCents ? (editing.compareAtCents / 100).toFixed(2) : ""} className="field text-[12px]" dir="ltr" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="p-category" className="mb-1 block text-[10.5px] text-[#a99c83]">التصنيف</label>
                <select id="p-category" name="category" defaultValue={editing?.category ?? "ebook"} className="field text-[12px]">
                  {CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.ar}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="p-format" className="mb-1 block text-[10.5px] text-[#a99c83]">الصيغة</label>
                <input id="p-format" name="format" defaultValue={editing?.format ?? "PDF"} className="field text-[12px]" placeholder="PDF / ZIP / MP3" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="p-cover" className="mb-1 block text-[10.5px] text-[#a99c83]">غلاف</label>
                <select id="p-cover" name="coverStyle" defaultValue={editing?.coverStyle ?? "nebula"} className="field text-[12px]">
                  {COVER_STYLES.map((style) => (
                    <option key={style.value} value={style.value}>{style.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="p-glyph" className="mb-1 block text-[10.5px] text-[#a99c83]">رمز الغلاف</label>
                <input id="p-glyph" name="coverGlyph" maxLength={4} defaultValue={editing?.coverGlyph ?? "✦"} className="field text-center text-[14px]" />
              </div>
            </div>
            <div>
              <label htmlFor="p-desc" className="mb-1 block text-[10.5px] text-[#a99c83]">الوصف الكامل (عربي) *</label>
              <textarea id="p-desc" name="description" rows={5} defaultValue={editing?.description ?? ""} className="field text-[12px]" placeholder="اكتب وصفًا صادقًا: لمن المنتج، ماذا يحتوي، وما النتيجة المتوقعة." />
            </div>
            <div>
              <label htmlFor="p-desc-en" className="mb-1 block text-[10.5px] text-[#a99c83]">الوصف الكامل (إنجليزي)</label>
              <textarea id="p-desc-en" name="descriptionEn" rows={4} defaultValue={editing?.descriptionEn ?? ""} className="field text-[12px]" dir="ltr" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="p-features" className="mb-1 block text-[10.5px] text-[#a99c83]">المزايا (سطر لكل ميزة)</label>
                <textarea id="p-features" name="features" rows={4} defaultValue={(editing?.features ?? []).join("\n")} className="field text-[12px]" />
              </div>
              <div>
                <label htmlFor="p-features-en" className="mb-1 block text-[10.5px] text-[#a99c83]">Features (EN)</label>
                <textarea id="p-features-en" name="featuresEn" rows={4} defaultValue={(editing?.featuresEn ?? []).join("\n")} className="field text-[12px]" dir="ltr" />
              </div>
            </div>
            <div>
              <label htmlFor="p-tags" className="mb-1 block text-[10.5px] text-[#a99c83]">الوسوم (مفصولة بفاصلة)</label>
              <input id="p-tags" name="tags" defaultValue={(editing?.tags ?? []).join(", ")} className="field text-[12px]" placeholder="إنتاجية, تركيز, عمل" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="p-limit" className="mb-1 block text-[10.5px] text-[#a99c83]">حد التحميل</label>
                <input id="p-limit" name="downloadLimit" type="number" min="1" max="50" defaultValue={editing?.downloadLimit ?? 5} className="field text-[12px]" dir="ltr" />
              </div>
              <div>
                <label htmlFor="p-status" className="mb-1 block text-[10.5px] text-[#a99c83]">النشر</label>
                <select id="p-status" name="status" defaultValue={editing?.status ?? "active"} className="field text-[12px]">
                  <option value="active">منشور</option>
                  <option value="draft">مسودة</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="p-file" className="mb-1 block text-[10.5px] text-[#a99c83]">ملف المنتج (حتى 30MB)</label>
              <input id="p-file" name="file" type="file" className="field text-[11.5px]" />
              {editing?.fileName ? <p className="mt-1 text-[10px] text-[#8f8ba2]">الملف الحالي: {editing.fileName} ({editing.fileSizeKb ?? 0} KB)</p> : null}
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-[#c3bece]">
              <input type="checkbox" name="featured" defaultChecked={editing?.featured ?? false} className="h-4 w-4" />
              إظهار في «مختارات أسترا»
            </label>
            <button type="submit" className="btn-gold w-full">{editing ? "حفظ التغييرات" : "إنشاء المنتج"}</button>
            {editing ? (
              <Link href="/admin/products" className="block text-center text-[11px] text-[#a9a4b8] hover:text-[#f0dcae]">إلغاء التعديل وإضافة منتج جديد</Link>
            ) : null}
          </div>
        </form>

        <div className="glass rounded-2xl p-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="font-display text-lg text-[#f4efe3]">الكتالوج ({all.length})</h2>
            <span className="text-[10.5px] text-[#8f8ba2]">كل الأسعار بالدولار</span>
          </div>
          <div className="table-wrap">
            <table className="w-full text-[11.5px]">
              <thead className="text-[9.5px] uppercase tracking-[0.16em] text-[#a99c83]">
                <tr>
                  <th className="px-2 py-2 text-start">المنتج</th>
                  <th className="px-2 py-2 text-start">السعر</th>
                  <th className="px-2 py-2 text-start">الحالة</th>
                  <th className="px-2 py-2 text-start">مبيعات</th>
                  <th className="px-2 py-2 text-start">الملف</th>
                  <th className="px-2 py-2 text-start">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {all.map((product) => (
                  <tr key={product.id} className="border-t border-white/5">
                    <td className="px-2 py-2">
                      <Link href={`/product/${product.slug}`} target="_blank" className="text-[#f0ecdf] hover:text-[#f0dcae]">{product.title}</Link>
                      <span className="block text-[9.5px] text-[#807c91]">{product.category} · {product.format}</span>
                    </td>
                    <td className="tabular px-2 py-2 text-[#d8c8a2]">{formatAmount(product.priceCents, "USD", "ar")}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[9.5px] ${product.status === "active" ? "border-emerald-400/30 text-emerald-200" : "border-white/15 text-white/60"}`}>
                        {product.status === "active" ? "منشور" : "مسودة"}
                      </span>
                    </td>
                    <td className="tabular px-2 py-2 text-[#a9a4b8]">{product.salesCount}</td>
                    <td className="px-2 py-2 text-[10px] text-[#a9a4b8]">{product.fileName ? "مرفوع" : "شهادة ترخيص"}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/products?edit=${product.id}`} className="text-[10.5px] text-[#e6d6ae] hover:underline">تعديل</Link>
                        <form action={deleteProduct}>
                          <input type="hidden" name="id" value={product.id} />
                          <button type="submit" className="text-[10.5px] text-rose-300 hover:underline">حذف</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {all.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-[#807c91]">لا منتجات. أضف أول منتج من النموذج.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
