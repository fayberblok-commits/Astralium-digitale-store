"use client";
/**
 * Web Push broadcast composer (Phase 6, feature 28): shows readiness
 * (VAPID + PII) and the subscriber count, and sends only with an
 * explicit per-send confirmation checkbox. Results report exactly
 * what happened (sent / expired-cleaned / failed).
 */
import { useEffect, useState } from "react";

interface PushDict {
  subscribers: string;
  titlePh: string;
  bodyPh: string;
  urlPh: string;
  confirm: string;
  send: string;
  sent: string;
  notConfigured: string;
}

export default function PushManager({ dict }: { dict: PushDict }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/en/shop");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/push")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setReady(Boolean(d.ready));
        setReason((d.reason as string | null) ?? null);
        setCount(Number(d.subscribers ?? 0));
      })
      .catch(() => setReady(false));
  }, []);

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, url, confirm }),
      });
      const data = (await res.json()) as { sent?: number; removed?: number; failed?: number; total?: number; error?: string };
      if (res.ok) {
        setResult(`${dict.sent}: ${data.sent ?? 0}/${data.total ?? 0} · −${data.removed ?? 0} · ✕${data.failed ?? 0}`);
        setConfirm(false);
      } else {
        setResult(data.error ?? "ERROR");
      }
    } catch {
      setResult("NETWORK_ERROR");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="summary-row">
        <span>{dict.subscribers}</span>
        <strong>{count}</strong>
      </p>
      {ready === false && (
        <p><span className="pill pill-bad">{dict.notConfigured}{reason ? `: ${reason}` : ""}</span></p>
      )}
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label>{dict.titlePh}<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} /></label>
        <label>{dict.bodyPh}<input value={body} onChange={(e) => setBody(e.target.value)} required maxLength={300} /></label>
        <label>{dict.urlPh}<input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          {dict.confirm}
        </label>
        <button type="submit" className="btn btn-primary" disabled={!confirm || busy || ready === false}>
          {dict.send}
        </button>
        {result && <p className="muted" role="status">{result}</p>}
      </form>
    </div>
  );
}
