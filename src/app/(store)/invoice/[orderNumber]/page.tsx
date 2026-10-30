import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCustomerSession } from "@/lib/auth";
import { getLocaleContext, formatDateTime } from "@/lib/locale";
import { formatAmount } from "@/lib/money";
import { getOrderWithItems } from "@/lib/store";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "الفاتورة" };

type Props = { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ at?: string }> };

export default async function InvoicePage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const query = await searchParams;
  const { locale } = await getLocaleContext();
  const [data, customer, settings] = await Promise.all([getOrderWithItems(orderNumber), getCustomerSession(), getSettings()]);
  if (!data) notFound();
  const { order, items } = data;
  const authorized = query.at === order.accessToken || (customer && customer.email === order.email);
  if (!authorized) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl text-[#f8f3e6]">{locale === "ar" ? "الفاتورة محمية" : "Invoice protected"}</h1>
        <p className="mt-2 text-[13px] text-[#a9a4b8]">
          {locale === "ar" ? "افتح الفاتورة من رابط الطلب أو من حسابك." : "Open the invoice from your order link or your account."}
        </p>
        <Link href="/account/login" className="btn-gold mt-4">
          {locale === "ar" ? "تسجيل الدخول" : "Sign in"}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="glass rounded-2xl p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="font-display text-xl tracking-[0.22em] text-[#f6f1e3]">ASTRALIUM</p>
            <p className="text-[9px] uppercase tracking-[0.4em] text-[#b8a883]">Digitale Store</p>
            <p className="mt-3 text-[11.5px] leading-relaxed text-[#9d99ad]">
              {locale === "ar" ? settings.supportEmail : settings.supportEmail}
              <br />
              {locale === "ar" ? "متجر رقمي مستقل — فاتورة إلكترونية" : "Independent digital store — electronic invoice"}
            </p>
          </div>
          <div className="text-end">
            <p className="text-[10px] uppercase tracking-[0.24em] text-[#d9b26a]">{locale === "ar" ? "فاتورة" : "Invoice"}</p>
            <p className="font-mono text-lg text-[#f0dcae]">{settings.invoicePrefix}-{order.orderNumber.replace("AST-", "")}</p>
            <p className="text-[11px] text-[#9d99ad]">{formatDateTime(order.paidAt ?? order.createdAt, locale)}</p>
            <p className="mt-1 text-[11px] text-[#9d99ad]">
              {locale === "ar" ? "الحالة:" : "Status:"} {order.status === "paid" ? (locale === "ar" ? "مدفوعة" : "Paid") : order.status === "refunded" ? (locale === "ar" ? "مسترجعة" : "Refunded") : locale === "ar" ? "غير مدفوعة" : "Unpaid"}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a99c83]">{locale === "ar" ? "إلى" : "Billed to"}</p>
            <p className="mt-1 text-[13px] text-[#f4efe3]">{order.name}</p>
            <p className="text-[12px] text-[#a9a4b8]" dir="ltr">
              {order.email}
            </p>
            <p className="text-[12px] text-[#a9a4b8]">{order.country}</p>
          </div>
          <div className="sm:text-end">
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a99c83]">{locale === "ar" ? "طريقة الدفع" : "Payment method"}</p>
            <p className="mt-1 text-[13px] text-[#f4efe3]">{order.paymentProvider === "sandbox" ? (locale === "ar" ? "بوابة اختبار آمنة" : "Secure test gateway") : order.paymentProvider}</p>
            <p className="text-[12px] text-[#a9a4b8]">{locale === "ar" ? "عملة الفاتورة:" : "Currency:"} {order.currency}</p>
          </div>
        </div>

        <div className="table-wrap mt-6 rounded-xl border border-white/10">
          <table className="w-full text-[12px]">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-[0.16em] text-[#a99c83]">
              <tr>
                <th className="px-3 py-2.5 text-start">{locale === "ar" ? "البند" : "Item"}</th>
                <th className="px-3 py-2.5 text-start">{locale === "ar" ? "الكمية" : "Qty"}</th>
                <th className="px-3 py-2.5 text-start">{locale === "ar" ? "السعر" : "Price"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ item, product }) => (
                <tr key={item.id} className="border-t border-white/5">
                  <td className="px-3 py-2.5 text-[#f0ecdf]">
                    {locale === "ar" ? product.title : product.titleEn || product.title}
                    <span className="block text-[10px] text-[#8f8ba2]">{product.format}</span>
                  </td>
                  <td className="tabular px-3 py-2.5 text-[#a9a4b8]">{item.quantity}</td>
                  <td className="tabular px-3 py-2.5 text-[#f0ecdf]">{formatAmount(item.unitPriceCents, order.currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 ms-auto max-w-xs space-y-1 text-[12px]">
          <div className="flex justify-between text-[#b3aec1]">
            <span>{locale === "ar" ? "المجموع الفرعي" : "Subtotal"}</span>
            <span className="tabular">{formatAmount(order.subtotalCents, order.currency, locale)}</span>
          </div>
          {order.discountCents > 0 ? (
            <div className="flex justify-between text-[#b3aec1]">
              <span>{locale === "ar" ? "الخصم" : "Discount"}</span>
              <span className="tabular">− {formatAmount(order.discountCents, order.currency, locale)}</span>
            </div>
          ) : null}
          {order.taxCents > 0 ? (
            <div className="flex justify-between text-[#b3aec1]">
              <span>{locale === "ar" ? settings.taxLabelAr : settings.taxLabelEn}</span>
              <span className="tabular">{formatAmount(order.taxCents, order.currency, locale)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-white/10 pt-1.5 text-[14px] text-[#f0dcae]">
            <span>{locale === "ar" ? "الإجمالي" : "Total"}</span>
            <span className="tabular">{formatAmount(order.totalCents, order.currency, locale)}</span>
          </div>
          <p className="pt-1 text-[10px] text-[#807c91]">
            {locale === "ar" ? "قيمة مرجعية بالدولار:" : "USD reference:"} {(order.baseTotalCents / 100).toFixed(2)} USD
          </p>
        </div>

        <div className="mt-6 border-t border-white/10 pt-4 text-[10.5px] leading-relaxed text-[#807c91]">
          <p>{locale === "ar" ? "هذه الفاتورة صادرة إلكترونيًا وصالحة دون توقيع. جميع الأسعار تشمل ما هو موضّح أعلاه، وضريبة القيمة المضافة تُطبق عند تفعيلها من مكتب المدير." : "This invoice is issued electronically and is valid without signature. VAT is applied when enabled in the owner's office."}</p>
          <p className="mt-1">{locale === "ar" ? "للاستفسار أو الاسترجاع:" : "Enquiries or refunds:"} {settings.supportEmail}</p>
        </div>
      </div>

      <div className="mt-4 flex justify-center gap-2">
        <Link href={`/checkout/success/${order.orderNumber}?at=${encodeURIComponent(order.accessToken)}`} className="btn-ghost px-3 py-1.5 text-[11.5px]">
          {locale === "ar" ? "رجوع إلى الطلب" : "Back to order"}
        </Link>
        <Link href="/account?tab=invoices" className="btn-ghost px-3 py-1.5 text-[11.5px]">
          {locale === "ar" ? "كل الفواتير" : "All invoices"}
        </Link>
      </div>
    </div>
  );
}
