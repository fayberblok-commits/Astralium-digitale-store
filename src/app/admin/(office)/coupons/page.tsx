import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { coupons } from "@/db/schema";
import { deleteCoupon, saveCoupon, toggleCoupon } from "@/app/admin/actions";
import { formatDate } from "@/lib/locale";
import { formatAmount } from "@/lib/money";

export const metadata: Metadata = { title: "الكوبونات", robots: { index: false, follow: false } };

type SearchParams = Promise<{ state?: string }>;

export default async function AdminCouponsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const all = await db.select().from(coupons).orderBy(desc(coupons.createdAt));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">الكوبونات والعروض</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">أنشئ كوبونات نسبية أو ثابتة، حدّد حدًا أدنى وحد استخدامات، وتابع الاستهلاك.</p>
      </div>

      {params.state ? (
        <div className="rounded-xl border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] px-4 py-2.5 text-[12px] text-[#f0dcae]">
          {params.state === "invalid" ? "أدخل رمزًا وقيمة صحيحة." : params.state === "saved" ? "تم حفظ الكوبون وتفعيله حسب الإعداد." : "تم تحديث الكوبونات."}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <form action={saveCoupon} className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">إنشاء / تحديث كوبون</h2>
          <div className="mt-3 space-y-2.5">
            <div>
              <label htmlFor="c-code" className="mb-1 block text-[10.5px] text-[#a99c83]">الرمز *</label>
              <input id="c-code" name="code" required className="field text-[12px] font-mono uppercase" dir="ltr" placeholder="ASTRAL10" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="c-kind" className="mb-1 block text-[10.5px] text-[#a99c83]">النوع</label>
                <select id="c-kind" name="kind" className="field text-[12px]">
                  <option value="percent">نسبة %</option>
                  <option value="fixed">مبلغ ثابت (USD)</option>
                </select>
              </div>
              <div>
                <label htmlFor="c-value" className="mb-1 block text-[10.5px] text-[#a99c83]">القيمة *</label>
                <input id="c-value" name="value" type="number" min="1" step="0.01" required className="field text-[12px]" dir="ltr" placeholder="10" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="c-min" className="mb-1 block text-[10.5px] text-[#a99c83]">حد أدنى (USD)</label>
                <input id="c-min" name="minSubtotal" type="number" min="0" step="0.01" className="field text-[12px]" dir="ltr" placeholder="0" />
              </div>
              <div>
                <label htmlFor="c-max" className="mb-1 block text-[10.5px] text-[#a99c83]">حد الاستخدامات</label>
                <input id="c-max" name="maxRedemptions" type="number" min="0" className="field text-[12px]" dir="ltr" placeholder="100" />
              </div>
            </div>
            <div>
              <label htmlFor="c-exp" className="mb-1 block text-[10.5px] text-[#a99c83]">تاريخ الانتهاء</label>
              <input id="c-exp" name="expiresAt" type="date" className="field text-[12px]" dir="ltr" />
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-[#c3bece]">
              <input type="checkbox" name="active" defaultChecked className="h-4 w-4" />
              نشط فورًا
            </label>
            <button type="submit" className="btn-gold w-full">حفظ الكوبون</button>
          </div>
        </form>

        <div className="glass rounded-2xl p-3">
          <h2 className="px-1 pb-2 font-display text-lg text-[#f4efe3]">الكوبونات ({all.length})</h2>
          <div className="table-wrap">
            <table className="w-full text-[11.5px]">
              <thead className="text-[9.5px] uppercase tracking-[0.16em] text-[#a99c83]">
                <tr>
                  <th className="px-2 py-2 text-start">الرمز</th>
                  <th className="px-2 py-2 text-start">القيمة</th>
                  <th className="px-2 py-2 text-start">الاستخدام</th>
                  <th className="px-2 py-2 text-start">الانتهاء</th>
                  <th className="px-2 py-2 text-start">الحالة</th>
                  <th className="px-2 py-2 text-start">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {all.map((coupon) => (
                  <tr key={coupon.id} className="border-t border-white/5">
                    <td className="px-2 py-2 font-mono text-[#f0dcae]">{coupon.code}</td>
                    <td className="px-2 py-2 text-[#d8c8a2]">{coupon.kind === "percent" ? `${coupon.value}%` : formatAmount(coupon.value, "USD", "ar")}</td>
                    <td className="tabular px-2 py-2 text-[#a9a4b8]">{coupon.redemptions}{coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ""}</td>
                    <td className="px-2 py-2 text-[#a9a4b8]">{coupon.expiresAt ? formatDate(coupon.expiresAt, "ar") : "بدون"}</td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[9.5px] ${coupon.active ? "border-emerald-400/30 text-emerald-200" : "border-white/15 text-white/60"}`}>
                        {coupon.active ? "نشط" : "موقوف"}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <form action={toggleCoupon}>
                          <input type="hidden" name="id" value={coupon.id} />
                          <input type="hidden" name="active" value={String(!coupon.active)} />
                          <button type="submit" className="text-[10.5px] text-[#e6d6ae] hover:underline">{coupon.active ? "إيقاف" : "تفعيل"}</button>
                        </form>
                        <form action={deleteCoupon}>
                          <input type="hidden" name="id" value={coupon.id} />
                          <button type="submit" className="text-[10.5px] text-rose-300 hover:underline">حذف</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {all.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-[#807c91]">لا كوبونات بعد.</td>
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
