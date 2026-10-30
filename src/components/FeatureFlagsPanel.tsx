"use client";
/**
 * Admin "Feature flags" panel: toggles each registered capability.
 * When no DB is configured the server answers persisted:false and this
 * panel says so — toggles then only preview the state for the session.
 */
import { useEffect, useState } from "react";

export interface FlagsDict {
  on: string;
  off: string;
  labels: Record<string, string>;
}

interface FlagRow {
  key: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
  persisted: boolean;
}

export default function FeatureFlagsPanel({ dict }: { dict: FlagsDict }) {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [dbConfigured, setDbConfigured] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/flags");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { dbConfigured: boolean; flags: FlagRow[] };
        setDbConfigured(data.dbConfigured);
        setFlags(data.flags);
      } catch {
        setError("flags load failed");
      }
    })();
  }, []);

  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { persisted: boolean };
      setFlags((fs) => fs.map((f) => (f.key === key ? { ...f, enabled, persisted: data.persisted } : f)));
      if (data.persisted) setDbConfigured(true);
    } catch {
      setError("flag update failed");
    } finally {
      setBusy(null);
    }
  }

  if (error && flags.length === 0) return <p className="pill pill-bad">{error}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="admin-table">
        <tbody>
          {flags.map((f) => (
            <tr key={f.key}>
              <td>
                <strong>{dict.labels[f.key] ?? f.key}</strong>
                <div className="muted">{f.description}</div>
                <code className="muted">{f.key}</code>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <span className={f.enabled ? "pill pill-ok" : "pill pill-bad"}>{f.enabled ? dict.on : dict.off}</span>{" "}
                <button
                  type="button"
                  className="btn"
                  disabled={busy === f.key}
                  onClick={() => void toggle(f.key, !f.enabled)}
                >
                  {f.enabled ? dict.off : dict.on}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <p className="pill pill-bad">{error}</p> : null}
      {!dbConfigured ? null : <span className="hidden" aria-hidden="true" />}
    </div>
  );
}
