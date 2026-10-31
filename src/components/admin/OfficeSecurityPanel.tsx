"use client";

/**
 * Manager's Office — security center (Phase 4 upgrade, item 8).
 * Owner-only (the API enforces the `security` permission). Shows the
 * honest session picture (stateless tokens: epoch + policy + locks +
 * known devices), 24h alert counters, a SEARCHABLE audit log, the
 * security event log, encrypted-backup status and provider health.
 */
import { useEffect, useState } from "react";

export interface OfficeSecurityDict {
  loading: string; sessions: string; epoch: string; auditSearch: string; backups: string;
  noBackups: string; health: string; alerts: string; events: string; locked: string;
  idle: string; hours: string;
}

interface CenterData {
  sessions: {
    epoch: number; idleMinutes: number; absoluteHours: number;
    lockedAccounts: { account: string; lockedUntil: string }[];
    knownDevices: Record<string, number>; note: string;
  };
  alerts24h: Record<string, number>;
  events: { id: string; kind: string; actor: string; createdAt: string }[];
  audit: { id: string; actor: string; role: string; action: string; target: string; createdAt: string }[];
  backups: { files: { name: string; sizeBytes: number; modifiedAt: string }[]; lastBackupAt: string | null };
  health: {
    providers: { name: string; ready: boolean; missing: string[] }[];
    ownerTotp: { enrolled: boolean; enabled: boolean; backupCodesRemaining: number };
    serverTime: string;
  };
}

export default function OfficeSecurityPanel({ dict }: { dict: OfficeSecurityDict }) {
  const [data, setData] = useState<CenterData | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load(query: string) {
    const res = await fetch(`/api/admin/office/security${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    setData((await res.json()) as CenterData);
  }
  useEffect(() => { void load(""); }, []);
  useEffect(() => { const t = setTimeout(() => void load(q), 300); return () => clearTimeout(t); }, [q]);

  if (!data) return <p className="muted">{error ?? dict.loading}</p>;
  return (
    <div>
      {error && <p className="form-error">{error}</p>}
      <h3>{dict.sessions}</h3>
      <p className="summary-row"><span>{dict.epoch}</span><strong>{data.sessions.epoch}</strong></p>
      <p className="summary-row"><span>{dict.idle}</span><span>{data.sessions.idleMinutes} min · {data.sessions.absoluteHours} {dict.hours}</span></p>
      <p className="muted">{data.sessions.note}</p>
      {data.sessions.lockedAccounts.length > 0 && (
        <p>{dict.locked}: {data.sessions.lockedAccounts.map((l) => l.account).join(", ")}</p>
      )}

      <h3>{dict.alerts}</h3>
      <div className="admin-grid">
        {Object.entries(data.alerts24h).map(([k, v]) => (
          <div key={k} className="stat-card"><span className="muted">{k}</span><strong>{v}</strong></div>
        ))}
      </div>

      <h3>{dict.health}</h3>
      {data.health.providers.map((p) => (
        <p key={p.name} className="summary-row">
          <span>{p.name}</span>
          {p.ready ? <span className="pill pill-ok">Configured</span> : <span className="pill pill-bad">Missing: {p.missing.join(", ")}</span>}
        </p>
      ))}
      <p className="summary-row"><span>2FA (owner)</span>
        <span>{data.health.ownerTotp.enabled ? "✓" : "—"} · backup codes: {data.health.ownerTotp.backupCodesRemaining}</span></p>

      <h3>{dict.backups}</h3>
      {data.backups.files.length === 0 ? <p className="muted">{dict.noBackups}</p> : (
        <table className="admin-table">
          <tbody>
            {data.backups.files.map((f) => (
              <tr key={f.name}><td><code>{f.name}</code></td><td>{Math.round(f.sizeBytes / 1024)} KB</td><td>{new Date(f.modifiedAt).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>{dict.events}</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <tbody>
            {data.events.slice(0, 25).map((e) => (
              <tr key={e.id}><td>{e.kind}</td><td>{e.actor}</td><td>{new Date(e.createdAt).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Audit</h3>
      <input type="search" value={q} placeholder={dict.auditSearch} onChange={(e) => setQ(e.target.value)} />
      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead><tr><th>Actor</th><th>Action</th><th>Target</th><th>When</th></tr></thead>
          <tbody>
            {data.audit.map((a) => (
              <tr key={a.id}><td>{a.actor} ({a.role})</td><td>{a.action}</td><td>{a.target}</td><td>{new Date(a.createdAt).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
