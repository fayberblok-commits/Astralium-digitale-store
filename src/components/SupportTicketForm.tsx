"use client";

/**
 * Public support ticket form (Phase 4 upgrade): posts to
 * /api/support/ticket (rate-limited + captcha-gated server-side when
 * configured). The ticket lands in the Manager's Office support
 * center; replies go to the customer's email.
 */
import { useState } from "react";

export interface SupportDict {
  email: string; subject: string; message: string; order: string; send: string; sent: string;
}

export default function SupportTicketForm({ dict, locale }: { dict: SupportDict; locale: string }) {
  const [form, setForm] = useState({ email: "", subject: "", message: "", orderRef: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/support/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, orderRef: form.orderRef || undefined, locale }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return; }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p className="ok-text">{dict.sent}</p>;
  return (
    <form className="admin-form" onSubmit={submit} style={{ maxWidth: 560 }}>
      <label>{dict.email}
        <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label>{dict.subject}
        <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={160} />
      </label>
      <label>{dict.order}
        <input value={form.orderRef} onChange={(e) => setForm({ ...form, orderRef: e.target.value })} maxLength={80} />
      </label>
      <label>{dict.message}
        <textarea required rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={5000} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{dict.send}</button>
    </form>
  );
}
