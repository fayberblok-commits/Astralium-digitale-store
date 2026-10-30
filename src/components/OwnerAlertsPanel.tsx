"use client";
/**
 * Owner notification center inbox (Phase 6, feature 26): live event
 * list with kind filter + mark-read, plus the external-channel
 * settings (digest email, owner WhatsApp number, Telegram toggle).
 * Live updates arrive over SSE; when EventSource fails the panel
 * falls back to 15s polling — same API either way.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface OwnerEvent {
  id: string;
  kind: string;
  title: string;
  detail: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface AlertsDict {
  empty: string;
  markAll: string;
  unread: string;
  filterAll: string;
  emailPh: string;
  whatsappPh: string;
  telegram: string;
  save: string;
  saved: string;
  kinds: Record<string, string>;
}

export default function OwnerAlertsPanel({ dict }: { dict: AlertsDict }) {
  const [events, setEvents] = useState<OwnerEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [kind, setKind] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [telegram, setTelegram] = useState(true);
  const [saved, setSaved] = useState(false);
  const [live, setLive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
    const res = await fetch(`/api/admin/alerts${qs}`);
    if (!res.ok) return;
    const data = (await res.json()) as { events: OwnerEvent[]; unread: number };
    setEvents(data.events);
    setUnread(data.unread);
  }, [kind]);

  useEffect(() => {
    void load();
    fetch("/api/admin/alerts/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const c = d.config as { email: string; whatsappNumber: string; telegramEnabled: boolean };
        setEmail(c.email);
        setWhatsapp(c.whatsappNumber);
        setTelegram(c.telegramEnabled);
      })
      .catch(() => undefined);
  }, [load]);

  // Live updates via SSE with polling fallback.
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/admin/alerts/stream");
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as { type?: string };
          if (data.type === "ready") setLive(true);
          if (data.type === "event") void load();
        } catch { /* heartbeat/comment frames */ }
      };
      es.onerror = () => {
        setLive(false);
        es?.close();
        if (!pollRef.current) pollRef.current = setInterval(() => void load(), 15000);
      };
    } catch {
      pollRef.current = setInterval(() => void load(), 15000);
    }
    return () => {
      es?.close();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [load]);

  async function mark(id: string) {
    await fetch("/api/admin/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    });
    void load();
  }

  async function markAll() {
    await fetch("/api/admin/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "readAll" }),
    });
    void load();
  }

  async function saveConfig() {
    const res = await fetch("/api/admin/alerts/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { email, whatsappNumber: whatsapp, telegramEnabled: telegram } }),
    });
    setSaved(res.ok);
    if (res.ok) setTimeout(() => setSaved(false), 2500);
  }

  const kindKeys = Object.keys(dict.kinds);
  return (
    <div>
      <p className="summary-row">
        <span>{dict.unread}: <strong>{unread}</strong>{live ? <> · <span className="pill pill-ok">live</span></> : null}</span>
        <button type="button" className="btn btn-ghost" onClick={markAll}>{dict.markAll}</button>
      </p>
      <p>
        <label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={dict.filterAll}>
            <option value="">{dict.filterAll}</option>
            {kindKeys.map((k) => (
              <option key={k} value={k}>{dict.kinds[k]}</option>
            ))}
          </select>
        </label>
      </p>
      {events.length === 0 ? (
        <p className="muted">{dict.empty}</p>
      ) : (
        <ul className="alerts-list">
          {events.map((e) => (
            <li key={e.id} className={e.readAt ? "alert-row alert-read" : "alert-row"}>
              <span className="pill">{dict.kinds[e.kind] ?? e.kind}</span>
              <span className="alert-title">{e.title}</span>
              <span className="muted">{new Date(e.createdAt).toLocaleString()}</span>
              {!e.readAt && (
                <button type="button" className="btn btn-ghost" onClick={() => void mark(e.id)}>✓</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={(ev) => { ev.preventDefault(); void saveConfig(); }}>
        <label>
          {dict.emailPh}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" />
        </label>
        <label>
          {dict.whatsappPh}
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+212600000000" />
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} />
          {dict.telegram}
        </label>
        <button type="submit" className="btn btn-primary">{saved ? dict.saved : dict.save}</button>
      </form>
    </div>
  );
}
