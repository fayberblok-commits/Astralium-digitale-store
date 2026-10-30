"use client";
/**
 * Privacy center forms (Phase 6, feature 30): export request, deletion
 * request (link-based, confirmed on the token page — never here), and
 * consent preferences (analytics/marketing). Requests always answer
 * with the same "check your email" message — no account enumeration.
 */
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";

export default function PrivacyCenterClient({ dict, locale }: { dict: Dict; locale: string }) {
  const [exportEmail, setExportEmail] = useState("");
  const [deleteEmail, setDeleteEmail] = useState("");
  const [sent, setSent] = useState<"export" | "delete" | null>(null);
  const [consentEmail, setConsentEmail] = useState("");
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(true);
  const [consentSaved, setConsentSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function request(kind: "export" | "delete", email: string) {
    setBusy(true);
    try {
      await fetch("/api/privacy/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, kind, locale }),
      });
      setSent(kind);
    } finally {
      setBusy(false);
    }
  }

  async function saveConsent() {
    setBusy(true);
    try {
      const res = await fetch("/api/privacy/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: consentEmail || undefined, analytics, marketing }),
      });
      if (res.ok) {
        // Mirror into the local consent store the banner/beacon read.
        try {
          localStorage.setItem("astralium-consent", analytics && marketing ? "all" : "essential");
        } catch { /* private mode */ }
        setConsentSaved(true);
        setTimeout(() => setConsentSaved(false), 3000);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="panel">
        <h2>{dict.pc_export_t}</h2>
        <p className="muted">{dict.pc_export_d}</p>
        <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void request("export", exportEmail); }}>
          <label>
            {dict.pc_email_ph}
            <input type="email" value={exportEmail} onChange={(e) => setExportEmail(e.target.value)} required placeholder="you@example.com" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>{dict.pc_request_btn}</button>
          {sent === "export" && <p role="status">{dict.pc_sent}</p>}
        </form>
      </section>

      <section className="panel">
        <h2>{dict.pc_consent_t}</h2>
        <p className="muted">{dict.pc_consent_d}</p>
        <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void saveConsent(); }}>
          <label>
            {dict.pc_email_ph}
            <input type="email" value={consentEmail} onChange={(e) => setConsentEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
            {dict.pc_consent_analytics}
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
            {dict.pc_consent_marketing}
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {consentSaved ? dict.pc_consent_saved : dict.pc_consent_save}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>{dict.pc_delete_t}</h2>
        <p className="muted">{dict.pc_delete_d}</p>
        <p className="notice" role="note">{dict.pc_delete_warn}</p>
        <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void request("delete", deleteEmail); }}>
          <label>
            {dict.pc_email_ph}
            <input type="email" value={deleteEmail} onChange={(e) => setDeleteEmail(e.target.value)} required placeholder="you@example.com" />
          </label>
          <button type="submit" className="btn btn-ghost" disabled={busy}>{dict.pc_delete_btn}</button>
          {sent === "delete" && <p role="status">{dict.pc_sent}</p>}
        </form>
      </section>
    </div>
  );
}
