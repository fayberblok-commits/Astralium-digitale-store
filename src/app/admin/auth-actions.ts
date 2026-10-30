"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import {
  clearPendingTwoFactor,
  createAdminSession,
  isRateLimited,
  readPendingTwoFactor,
  registerLoginAttempt,
  revokeAdminSession,
  setPendingTwoFactor,
  writeAudit,
} from "@/lib/auth";
import { decryptSecret, verifyPassword, verifyTotp } from "@/lib/crypto";

type StepState = { step?: "totp"; error?: string } | null;

export async function beginAdminLogin(_prev: StepState, formData: FormData): Promise<StepState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "أدخل البريد الإلكتروني وكلمة المرور." };
  if (await isRateLimited(email, "admin")) {
    await writeAudit("auth.rate_limited", "admin", null, { email }, email);
    return { error: "محاولات دخول كثيرة. تم إيقاف المحاولة مؤقتًا لمدة 15 دقيقة." };
  }
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  const admin = rows[0];
  if (!admin || admin.role !== "owner" || !verifyPassword(password, admin.passwordHash)) {
    await registerLoginAttempt(email, false, "admin");
    await writeAudit("auth.denied", "admin", null, { email }, email);
    return { error: "بيانات الدخول غير صحيحة. هذا المكتب مخصص للمالك فقط." };
  }
  await registerLoginAttempt(email, true, "admin");
  await setPendingTwoFactor(admin.id);
  return { step: "totp" };
}

export async function verifyAdminTwoFactor(_prev: StepState, formData: FormData): Promise<StepState> {
  const code = String(formData.get("code") ?? "").trim();
  const adminId = await readPendingTwoFactor();
  if (!adminId) return { error: "انتهت جلسة التحقق. أعد إدخال كلمة المرور." };
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId)).limit(1);
  const admin = rows[0];
  if (!admin) return { error: "الحساب غير متاح." };
  const secret = decryptSecret(admin.totpSecret);
  if (!secret || !verifyTotp(secret, code)) {
    await registerLoginAttempt(admin.email, false, "admin");
    await writeAudit("auth.totp_failed", "admin", admin.id, {}, admin.email);
    return { error: "رمز التحقق غير صحيح. استخدم رمزًا جديدًا من تطبيق المصادقة." };
  }
  await clearPendingTwoFactor();
  await createAdminSession(admin.id);
  await writeAudit("auth.login", "admin", admin.id, {}, admin.email);
  redirect("/admin");
}

export async function adminLogout() {
  await writeAudit("auth.logout", "admin", null, {});
  await revokeAdminSession();
  redirect("/admin/login");
}
