import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSessions, adminUsers } from "@/db/schema";
import { changeAdminPassword, createBackupRecord, revokeAllAdminSessions, rotateTwoFactor } from "@/app/admin/actions";
import { requireOwner, writeAudit } from "@/lib/auth";
import { decryptSecret, totpUri } from "@/lib/crypto";
import { formatDateTime } from "@/lib/locale";
import { getAuditLogs } from "@/lib/store";
import { gatewayEnvStatus } from "@/lib/settings";

export const metadata: Metadata = { title: "الأمان والنسخ الاحتياطي", robots: { index: false, follow: false } };

type SearchParams = Promise<{ state?: string }>;

export default async function AdminSecurityPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const admin = await requireOwner();
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id)).limit(1);
  const record = rows[0];
  const secret = record ? decryptSecret(record.totpSecret) : "";
  const qr = secret ? await QRCode.toDataURL(totpUri(admin.email, secret), { margin: 1, width: 220, color: { dark: "#0a0c1c", light: "#f0dcae" } }) : null;
  const sessions = await db.select().from(adminSessions).where(eq(adminSessions.adminId, admin.id)).orderBy(desc(adminSessions.createdAt)).limit(8);
  const logs = await getAuditLogs(25);
  const env = gatewayEnvStatus();
  await writeAudit("security.page_viewed", "admin", admin.id, {}, admin.email);

  const notices: Record<string, string> = {
    password_saved: "تم تغيير كلمة المرور. أي جلسات سابقة تبقى صالحة حتى انتهائها — يمكنك إبطالها أدناه.",
    password_invalid: "كلمة المرور الحالية غير صحيحة.",
    password_short: "كلمة المرور الجديدة يجب أن تكون 10 أحرف على الأقل.",
    totp_rotated: "تم توليد مفتاح تحقق ثنائي جديد. امسح رمز QR بتطبيق المصادقة فورًا؛ الرمز السابق لم يعد يعمل.",
    backup_created: "تم تسجيل نقطة نسخة احتياطية. يمكنك تنزيل نسخة JSON من الزر أدناه.",
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-[#f8f3e6]">الأمان والنسخ الاحتياطي</h1>
        <p className="mt-1 text-[12px] text-[#9d99ad]">2FA إلزامي، جلسات موقّعة، تحديد محاولات، سجل عمليات كامل، ونسخة قابلة للتنزيل.</p>
      </div>

      {params.state && notices[params.state] ? (
        <div className={`rounded-xl border px-4 py-2.5 text-[12px] ${params.state.includes("invalid") || params.state.includes("short") ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}>
          {notices[params.state]}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">التحقق بخطوتين (TOTP)</h2>
          <p className="mt-1 text-[11px] text-[#a9a4b8]">مطلوب في كل تسجيل دخول، ولا يمكن الدخول بدونه.</p>
          {qr ? (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="رمز QR للمصادقة الثنائية" width={150} height={150} className="rounded-xl border border-white/10" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-[#a9a4b8]">امسح الرمز بتطبيق Google Authenticator أو 1Password.</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10.5px] text-[#d8c8a2]">إظهار المفتاح النصي</summary>
                  <p className="mt-1 break-all rounded-lg bg-[#080a17] px-2 py-1.5 font-mono text-[10.5px] text-[#f0dcae]" dir="ltr">{secret}</p>
                </details>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-[11.5px] text-rose-200">لم يتم العثور على مفتاح صالح. استخدم «توليد مفتاح جديد».</p>
          )}
          <form action={rotateTwoFactor} className="mt-3">
            <button type="submit" className="btn-ghost w-full py-1.5 text-[11.5px]">توليد مفتاح جديد (يُبطل القديم)</button>
          </form>
        </div>

        <form action={changeAdminPassword} className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">كلمة مرور المالك</h2>
          <div className="mt-3 space-y-2">
            <input name="currentPassword" type="password" required className="field text-[12px]" dir="ltr" autoComplete="current-password" placeholder="كلمة المرور الحالية" aria-label="كلمة المرور الحالية" />
            <input name="newPassword" type="password" required minLength={10} className="field text-[12px]" dir="ltr" autoComplete="new-password" placeholder="كلمة المرور الجديدة (10 أحرف على الأقل)" aria-label="كلمة المرور الجديدة" />
            <button type="submit" className="btn-gold w-full">تحديث كلمة المرور</button>
          </div>
          <p className="mt-2 text-[10px] text-[#807c91]">كلمات المرور تُجزَّأ بـ scrypt مع ملح عشوائي، ولا يمكن استعادتها نصًا.</p>
        </form>

        <div className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">الجلسات النشطة</h2>
          <div className="mt-2 space-y-1.5 text-[10.5px]">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                <div>
                  <p className="text-[#ded9e7]" dir="ltr">{session.ip ?? "—"}</p>
                  <p className="text-[9.5px] text-[#807c91]">{formatDateTime(session.createdAt, "ar")} → {formatDateTime(session.expiresAt, "ar")}</p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[9px] ${session.revokedAt ? "border-white/15 text-white/50" : "border-emerald-400/30 text-emerald-200"}`}>
                  {session.revokedAt ? "مبطلة" : "نشطة"}
                </span>
              </div>
            ))}
          </div>
          <form action={revokeAllAdminSessions} className="mt-3">
            <button type="submit" className="btn-ghost w-full py-1.5 text-[11px]">إبطال كل الجلسات والخروج</button>
          </form>
        </div>

        <div className="glass rounded-2xl p-4">
          <h2 className="font-display text-lg text-[#f4efe3]">النسخ الاحتياطي</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[#a9a4b8]">
            نسخة JSON كاملة من الكتالوج والطلبات والعملاء (بدون بيانات بنكية أو أسرار) قابلة للتنزيل من خادمك.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/api/admin/backup" className="btn-ghost px-3 py-1.5 text-[11px]" prefetch={false}>تنزيل نسخة JSON</Link>
            <form action={createBackupRecord}>
              <button type="submit" className="btn-ghost px-3 py-1.5 text-[11px]">تسجيل نقطة استعادة</button>
            </form>
          </div>
          <p className="mt-2 text-[10px] text-[#807c91]">
            في الإنتاج: شغّل `pg_dump` يوميًا إلى تخزين مشفّر خارج الخادم، واحفظ `APP_ENCRYPTION_KEY` في مدير أسرار منفصل.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-[9.5px] text-[#8f8ba2]">
            <span className="chip">HSTS</span>
            <span className="chip">HttpOnly Sessions</span>
            <span className="chip">Rate limiting</span>
            <span className="chip">AES-256-GCM vault</span>
            <span className="chip">Signed webhooks</span>
            <span className="chip">{env.stripeWebhook ? "Stripe webhook verified" : "Webhook: awaiting key"}</span>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-4">
        <h2 className="font-display text-lg text-[#f4efe3]">سجل العمليات (Audit log)</h2>
        <div className="table-wrap mt-2">
          <table className="w-full text-[10.5px]">
            <thead className="text-[9px] uppercase tracking-[0.16em] text-[#a99c83]">
              <tr>
                <th className="px-2 py-1.5 text-start">الوقت</th>
                <th className="px-2 py-1.5 text-start">الفاعل</th>
                <th className="px-2 py-1.5 text-start">العملية</th>
                <th className="px-2 py-1.5 text-start">الكيان</th>
                <th className="px-2 py-1.5 text-start">IP</th>
                <th className="px-2 py-1.5 text-start">تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-white/5 text-[#a9a4b8]">
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatDateTime(log.createdAt, "ar")}</td>
                  <td className="px-2 py-1.5" dir="ltr">{log.actor}</td>
                  <td className="px-2 py-1.5 font-mono text-[10px] text-[#d8c8a2]">{log.action}</td>
                  <td className="px-2 py-1.5">{log.entity}{log.entityId ? ` #${log.entityId}` : ""}</td>
                  <td className="px-2 py-1.5" dir="ltr">{log.ip}</td>
                  <td className="max-w-[240px] truncate px-2 py-1.5 font-mono text-[9px]">{JSON.stringify(log.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
