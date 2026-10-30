import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AdminLoginForm } from "@/components/admin/admin-login";
import { getAdminSession } from "@/lib/auth";

export const metadata: Metadata = { title: "مكتب المدير — دخول المالك", robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  const admin = await getAdminSession();
  if (admin) redirect("/admin");

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(700px_420px_at_50%_0%,rgba(217,178,106,0.16),transparent_65%)]" />
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(217,178,106,0.45)] bg-[radial-gradient(circle_at_30%_25%,rgba(240,220,174,0.3),rgba(5,6,15,0.9))] text-2xl text-[#f0dcae]">
            ✦
          </span>
          <p className="mt-3 font-display text-lg tracking-[0.26em] text-[#f6f1e3]">ASTRALIUM</p>
          <p className="text-[9px] uppercase tracking-[0.42em] text-[#b8a883]">Owner&apos;s Office</p>
          <h1 className="mt-4 font-display text-2xl text-[#f8f3e6]">مكتب المدير</h1>
          <p className="mt-1 text-[11.5px] text-[#9d99ad]">منطقة محمية — المالك الوحيد فقط</p>
        </div>
        <div className="glass rounded-2xl p-6">
          <AdminLoginForm />
        </div>
        <div className="mt-4 text-center">
          <Link href="/" className="text-[11px] text-[#a9a4b8] hover:text-[#f0dcae]">
            ← العودة إلى المتجر
          </Link>
        </div>
      </div>
    </div>
  );
}
