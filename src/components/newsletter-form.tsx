"use client";

import { useActionState } from "react";
import { subscribeNewsletter } from "@/app/actions";

type State = { ok?: boolean; message?: string } | null;

export function NewsletterForm({ placeholder, buttonLabel }: { placeholder: string; buttonLabel: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: State, formData: FormData): Promise<State> => subscribeNewsletter(formData),
    null,
  );
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder={placeholder}
          aria-label={placeholder}
          className="field text-[12px]"
        />
        <button type="submit" disabled={pending} className="btn-gold px-4 py-2 text-[12px] disabled:opacity-60">
          {buttonLabel}
        </button>
      </div>
      {state?.message ? (
        <p className={`text-[11.5px] ${state.ok ? "text-emerald-300" : "text-rose-300"}`}>{state.message}</p>
      ) : null}
    </form>
  );
}
