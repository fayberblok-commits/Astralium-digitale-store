import { adminConfigured } from "../../../../lib/admin";
import AdminLoginClient from "../../../../components/AdminLoginClient";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <AdminLoginClient locale={locale} configured={adminConfigured()} />;
}
