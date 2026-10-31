"use client";

/**
 * Step-up re-authentication form (Phase 4 upgrade): shown inline when
 * a sensitive office action answers STEP_UP_REQUIRED. Posts the
 * admin's password (+ TOTP code when enrolled) to /api/admin/step-up,
 * which sets the 5-minute step-up cookie; the caller then retries.
 */
import { useState } from "react";

export interface StepUpDict {
  title: string;
  password: string;
  code: string;
  submit: string;
  done: string;
}

export default function StepUpForm({
  dict,
  onDone,
}: {
  dict: StepUpDict;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, code: code || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form office-stepup" onSubmit={submit}>
      <p><strong>{dict.title}</strong></p>
      <label>
        {dict.password}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      <label>
        {dict.code}
        <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{dict.submit}</button>
    </form>
  );
}
