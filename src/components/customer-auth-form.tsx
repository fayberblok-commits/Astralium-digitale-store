"use client";

import Link from "next/link";
import { useActionState } from "react";
import { customerLogin, customerRegister } from "@/app/actions";

type Mode = "login" | "register";
type State = { error?: string } | null;

export function CustomerAuthForm({
  mode,
  referral,
  labels,
}: {
  mode: Mode;
  referral?: string;
  labels: { name: string; email: string; password: string; submit: string; altText: string; altLink: string; refLabel: string };
}) {
  const action = mode === "login" ? customerLogin : customerRegister;
  const [state, formAction, pending] = useActionState(async (_prev: State, formData: FormData): Promise<State> => {
    return (await action(formData)) ?? null;
  }, null);

  return (
    <form action={formAction} className="space-y-3">
      {mode === "register" ? (
        <div>
          <label htmlFor="auth-name" className="mb-1 block text-[11px] text-[#b3a98f]">
            {labels.name}
          </label>
          <input id="auth-name" name="name" required minLength={2} maxLength={120} className="field" autoComplete="name" placeholder="نورة الغامدي" />
        </div>
      ) : null}
      <div>
        <label htmlFor="auth-email" className="mb-1 block text-[11px] text-[#b3a98f]">
          {labels.email}
        </label>
        <input id="auth-email" name="email" type="email" required className="field" dir="ltr" autoComplete="email" placeholder="name@example.com" />
      </div>
      <div>
        <label htmlFor="auth-password" className="mb-1 block text-[11px] text-[#b3a98f]">
          {labels.password}
        </label>
        <input
          id="auth-password"
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 8 : 1}
          className="field"
          dir="ltr"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          placeholder="••••••••"
        />
      </div>
      {mode === "register" ? (
        <div>
          <label htmlFor="auth-ref" className="mb-1 block text-[11px] text-[#b3a98f]">
            {labels.refLabel}
          </label>
          <input id="auth-ref" name="ref" defaultValue={referral} className="field" dir="ltr" placeholder="AST-0F2A" />
        </div>
      ) : null}
      {state?.error ? <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] text-rose-100">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="btn-gold w-full disabled:opacity-60">
        {pending ? "جارٍ المعالجة…" : labels.submit}
      </button>
      <p className="text-center text-[11.5px] text-[#9d99ad]">
        {labels.altText}{" "}
        <Link href={mode === "login" ? "/account/register" : "/account/login"} className="text-[#e6d6ae] hover:underline">
          {labels.altLink}
        </Link>
      </p>
    </form>
  );
}
