"use client";

import { useActionState } from "react";
import { beginAdminLogin, verifyAdminTwoFactor } from "@/app/admin/auth-actions";

type State = { step?: "totp"; error?: string } | null;

export function AdminLoginForm() {
  const [credState, credAction, credPending] = useActionState(async (_prev: State, formData: FormData): Promise<State> => beginAdminLogin(_prev, formData), null);
  const [totpState, totpAction, totpPending] = useActionState(async (_prev: State, formData: FormData): Promise<State> => verifyAdminTwoFactor(_prev, formData), null);

  return (
    <div className="space-y-4">
      {credState?.step === "totp" ? (
        <form action={totpAction} className="space-y-3">
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[12px] text-emerald-100">
            تم التحقق من كلمة المرور. أدخل رمز المصادقة الثنائية (6 أرقام) من تطبيق المصادقة.
          </div>
          <div>
            <label htmlFor="admin-code" className="mb-1 block text-[11px] text-[#b3a98f]">
              رمز التحقق الثنائي
            </label>
            <input
              id="admin-code"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              required
              maxLength={6}
              autoComplete="one-time-code"
              className="field text-center font-mono text-xl tracking-[0.5em]"
              placeholder="000000"
            />
          </div>
          {totpState?.error ? <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">{totpState.error}</p> : null}
          <button type="submit" disabled={totpPending} className="btn-gold w-full disabled:opacity-60">
            {totpPending ? "جارٍ التحقق…" : "دخول مكتب المدير"}
          </button>
        </form>
      ) : (
        <form action={credAction} className="space-y-3">
          <div>
            <label htmlFor="admin-email" className="mb-1 block text-[11px] text-[#b3a98f]">
              بريد المالك
            </label>
            <input id="admin-email" name="email" type="email" required autoComplete="username" dir="ltr" className="field" placeholder="owner@astralium.store" />
          </div>
          <div>
            <label htmlFor="admin-password" className="mb-1 block text-[11px] text-[#b3a98f]">
              كلمة المرور
            </label>
            <input id="admin-password" name="password" type="password" required autoComplete="current-password" dir="ltr" className="field" placeholder="••••••••••" />
          </div>
          {credState?.error ? <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">{credState.error}</p> : null}
          <button type="submit" disabled={credPending} className="btn-gold w-full disabled:opacity-60">
            {credPending ? "جارٍ التحقق…" : "متابعة إلى التحقق الثنائي"}
          </button>
        </form>
      )}
      <p className="text-center text-[10.5px] leading-relaxed text-[#807c91]">
        دخول محمي بكلمة مرور + رمز TOTP، مع تحديد المحاولات وتسجيل كل محاولة. أي حساب غير حساب المالك يُرفض.
      </p>
    </div>
  );
}
