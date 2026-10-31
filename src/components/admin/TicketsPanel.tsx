"use client";

/**
 * Manager's Office — support tickets (Phase 4 upgrade, item 6).
 * Customers open tickets from the storefront support page (or the AI
 * assistant's human handoff); the office triages them here. Replies go
 * from the owner's own mailbox — the ticket shows the customer's email.
 */
import { useEffect, useState } from "react";

export interface TicketsDict {
  loading: string; empty: string; replyHint: string;
  statusOpen: string; statusAnswered: string; statusClosed: string;
}

interface Ticket {
  id: string; email: string; subject: string; message: string;
  orderRef: string | null; locale: string | null;
  status: "open" | "answered" | "closed"; createdAt: string; updatedAt: string;
}

export default function TicketsPanel({ dict }: { dict: TicketsDict }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/office/tickets");
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as { tickets: Ticket[] };
    setTickets(d.tickets);
  }
  useEffect(() => { void load(); }, []);

  async function setStatus(id: string, status: Ticket["status"]) {
    const res = await fetch("/api/admin/office/tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }),
    });
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    await load();
  }

  const label = (s: Ticket["status"]) => (s === "open" ? dict.statusOpen : s === "answered" ? dict.statusAnswered : dict.statusClosed);

  if (!tickets) return <p className="muted">{error ?? dict.loading}</p>;
  if (tickets.length === 0) return <p className="muted">{dict.empty}</p>;
  return (
    <div>
      <p className="muted">{dict.replyHint}</p>
      {error && <p className="form-error">{error}</p>}
      {tickets.map((t) => (
        <div key={t.id} className="panel office-detail">
          <p className="summary-row">
            <span><strong>{t.subject}</strong> · {t.email}{t.orderRef ? ` · ${t.orderRef}` : ""}</span>
            <span className={t.status === "open" ? "pill pill-bad" : "pill pill-ok"}>{label(t.status)}</span>
          </p>
          <p>{t.message}</p>
          <p className="muted">{new Date(t.createdAt).toLocaleString()}</p>
          <div className="btn-row">
            {(["open", "answered", "closed"] as const).filter((s) => s !== t.status).map((s) => (
              <button key={s} type="button" className="btn" onClick={() => void setStatus(t.id, s)}>{label(s)}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
