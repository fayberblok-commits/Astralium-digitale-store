"use client";
/**
 * Admin "Delivery channels" panel (Phase 2): per-channel flag state and
 * provider readiness (env presence only), the WhatsApp template status,
 * channel stats, the delivery-attempt log, and a manual resend action.
 * Flag toggling itself lives in the Feature flags panel above; this
 * panel is the operational view of the delivery system.
 */
import { useEffect, useState } from "react";

export interface DeliveryDict {
  channel: string;
  flag: string;
  provider: string;
  ready: string;
  notReady: string;
  on: string;
  off: string;
  template: string;
  templateNote: string;
  stats: string;
  log: string;
  logEmpty: string;
  resend: string;
  order: string;
  status: string;
  when: string;
  labels: Record<string, string>;
}

interface ChannelRow {
  key: string;
  enabled: boolean;
  configured: boolean;
  missing: string[];
  available: boolean;
}
interface StatRow {
  channel: string;
  total: number;
  sent: number;
  failed: number;
}
interface AttemptRow {
  id: string;
  orderId: string;
  channel: string;
  status: string;
  errorCode: string | null;
  createdAt: string;
}

export default function DeliveryChannelsPanel({ dict }: { dict: DeliveryDict }) {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [template, setTemplate] = useState<{ name: string; status: string } | null>(null);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/delivery");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        channels: ChannelRow[];
        template: { name: string; status: string };
        stats: StatRow[];
        attempts: AttemptRow[];
      };
      setChannels(data.channels);
      setTemplate(data.template);
      setStats(data.stats);
      setAttempts(data.attempts);
    } catch {
      setError("delivery load failed");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function resend(a: AttemptRow) {
    setBusyId(a.id);
    setResendNote(null);
    try {
      const res = await fetch("/api/admin/delivery/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: a.orderId, channel: a.channel }),
      });
      const data = (await res.json()) as { ok?: boolean; deliveredVia?: string | null; error?: string };
      setResendNote(res.ok ? `${a.orderId}: ${data.deliveredVia ?? "—"}` : `${a.orderId}: ${data.error ?? res.status}`);
      await load();
    } catch {
      setResendNote(`${a.orderId}: network error`);
    } finally {
      setBusyId(null);
    }
  }

  if (error && channels.length === 0) return <p className="pill pill-bad">{error}</p>;
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr><th>{dict.channel}</th><th>{dict.flag}</th><th>{dict.provider}</th></tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.key}>
                <td><strong>{dict.labels[c.key] ?? c.key}</strong></td>
                <td><span className={c.enabled ? "pill pill-ok" : "pill pill-bad"}>{c.enabled ? dict.on : dict.off}</span></td>
                <td>
                  {c.configured ? (
                    <span className="pill pill-ok">{dict.ready}</span>
                  ) : (
                    <span className="pill pill-bad">{dict.notReady}: {c.missing.join(", ")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {template && (
        <p className="summary-row">
          <span>{dict.template}: <code>{template.name}</code></span>
          <span className={template.status === "configured-name" ? "pill pill-ok" : "pill pill-bad"}>{template.status}</span>
        </p>
      )}
      <p className="muted">{dict.templateNote}</p>

      {stats.length > 0 && (
        <>
          <h3>{dict.stats}</h3>
          <p className="muted">
            {stats.map((s) => `${dict.labels[s.channel] ?? s.channel}: ${s.total} / ${s.sent} / ${s.failed}`).join(" · ")}
          </p>
        </>
      )}

      <h3>{dict.log}</h3>
      {attempts.length === 0 ? (
        <p className="muted">{dict.logEmpty}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr><th>{dict.when}</th><th>{dict.order}</th><th>{dict.channel}</th><th>{dict.status}</th><th></th></tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.createdAt).toLocaleString()}</td>
                  <td><code>{a.orderId}</code></td>
                  <td>{dict.labels[a.channel] ?? a.channel}</td>
                  <td>
                    <span className={a.status === "failed" ? "pill pill-bad" : "pill pill-ok"}>{a.status}</span>
                    {a.errorCode ? <div className="muted">{a.errorCode}</div> : null}
                  </td>
                  <td>
                    <button type="button" className="btn" disabled={busyId === a.id} onClick={() => void resend(a)}>
                      {dict.resend}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resendNote ? <p className="muted">{resendNote}</p> : null}
    </div>
  );
}
