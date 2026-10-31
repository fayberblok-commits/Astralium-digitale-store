"use client";

/**
 * Manager's Office — design versions & rollback (Phase 4 upgrade,
 * item 5): snapshot the whole design state (theme + homepage
 * sections + banner + hero text) under a name, and restore any
 * snapshot with one click. Rolling back first snapshots the current
 * state as an automatic backup, so a restore is itself undoable.
 */
import { useEffect, useState } from "react";

export interface VersionsDict {
  loading: string; versions: string; snapshot: string; snapshotName: string;
  rollback: string; rollbackDone: string; palette: string;
}

interface VersionRow {
  id: string; name: string; author: string; createdAt: string;
  palette: string; mode: string; hiddenSections: number;
}

export default function DesignVersionsPanel({ dict }: { dict: VersionsDict }) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/office/design");
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as { versions: VersionRow[] };
    setVersions(d.versions);
  }
  useEffect(() => { void load(); }, []);

  async function post(body: unknown): Promise<boolean> {
    const res = await fetch("/api/admin/office/design", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { setError(`HTTP ${res.status}`); return false; }
    await load();
    return true;
  }

  if (!versions) return <p className="muted">{error ?? dict.loading}</p>;
  return (
    <div>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}
      <form className="admin-form office-inline" onSubmit={(e) => {
        e.preventDefault();
        void post({ action: "snapshot", name }).then((ok) => { if (ok) setName(""); });
      }}>
        <label>{dict.snapshotName}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <button type="submit" className="btn btn-primary">{dict.snapshot}</button>
      </form>
      <h4>{dict.versions}</h4>
      {versions.length === 0 ? <p className="muted">—</p> : (
        <table className="admin-table">
          <thead><tr><th>{dict.snapshotName}</th><th>{dict.palette}</th><th>Date</th><th /></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td><td>{v.palette} · {v.mode}</td>
                <td>{new Date(v.createdAt).toLocaleString()}</td>
                <td>
                  <button type="button" className="btn" onClick={() => {
                    void post({ action: "rollback", id: v.id }).then((ok) => { if (ok) setNotice(dict.rollbackDone); });
                  }}>{dict.rollback}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
