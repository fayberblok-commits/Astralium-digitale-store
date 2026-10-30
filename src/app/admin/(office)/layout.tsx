import Link from "next/link";
import type { ReactNode } from "react";
import { adminLogout } from "@/app/admin/auth-actions";
import { requireOwner } from "@/lib/auth";
import { getSettings, gatewayEnvStatus } from "@/lib/settings";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "لوحة القيادة", glyph: "◈" },
  { href: "/admin/orders", label: "الطلبات", glyph: "▤" },
  { href: "/admin/products", label: "المنتجات", glyph: "✦" },
  { href: "/admin/customers", label: "العملاء", glyph: "◐" },
  { href: "/admin/coupons", label: "الكوبونات", glyph: "%" },
  { href: "/admin/agents", label: "الموظفون الاصطناعيون", glyph: "⚛" },
  { href: "/admin/ai", label: "فريق المدير الذكي", glyph: "⌘" },
  { href: "/admin/support", label: "الدعم والتذاكر", glyph: "✉" },
  { href: "/admin/design", label: "التصميم والمحتوى", glyph: "◍" },
  { href: "/admin/languages", label: "اللغات", glyph: "⌖" },
  { href: "/admin/payments", label: "الدفع والحساب البنكي", glyph: "▣" },
  { href: "/admin/security", label: "الأمان والنسخ الاحتياطي", glyph: "⛨" },
];

export default async function AdminOfficeLayout({ children }: { children: ReactNode }) {
  const admin = await requireOwner();
  const settings = await getSettings();
  const gateways = gatewayEnvStatus();

  return (
    <div className="min-h-screen bg-[#05060f]">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-[rgba(217,178,106,0.16)] bg-[rgba(6,8,20,0.92)] lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-e">
          <div className="flex items-center justify-between px-4 py-4">
            <Link href="/admin" className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(217,178,106,0.45)] text-[#f0dcae]">✦</span>
              <span>
                <span className="block font-display text-[13px] tracking-[0.22em] text-[#f6f1e3]">ASTRALIUM</span>
                <span className="text-[8px] uppercase tracking-[0.34em] text-[#b8a883]">Owner&apos;s Office</span>
              </span>
            </Link>
            <Link href="/" className="text-[10px] text-[#a9a4b8] hover:text-[#f0dcae]" target="_blank">
              المتجر ↗
            </Link>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible" aria-label="Office navigation">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-[#bab5c8] transition hover:bg-[rgba(217,178,106,0.12)] hover:text-[#f5e7c1] lg:text-[12.5px]"
              >
                <span aria-hidden="true" className="w-4 text-center text-[#d9b26a]">
                  {item.glyph}
                </span>
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className="hidden border-t border-white/10 px-4 py-4 text-[10.5px] leading-relaxed text-[#8f8ba2] lg:block">
            <p className="text-[#d8cbaa]">{admin.name}</p>
            <p className="truncate" dir="ltr">
              {admin.email}
            </p>
            <p className="mt-2">وضع الدفع: {settings.testMode ? "اختبار" : "حقيقي"}</p>
            <p>Stripe: {gateways.stripe ? "متصل" : "غير مهيأ"} · PayPal: {gateways.paypal ? "متصل" : "غير مهيأ"}</p>
          </div>
        </aside>

        <div className="flex-1">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[rgba(8,10,22,0.7)] px-4 py-3">
            <p className="text-[12px] text-[#9d99ad]">مكتب المدير — كل البيانات هنا سرية ولا تظهر في أي صفحة للمشترين.</p>
            <div className="flex items-center gap-2">
              <span className="chip">{settings.testMode ? "TEST MODE" : "LIVE"}</span>
              <form action={adminLogout}>
                <button type="submit" className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-[#c9c4d4] hover:border-rose-300/40 hover:text-rose-200">
                  خروج آمن
                </button>
              </form>
            </div>
          </header>
          <main className="px-4 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
