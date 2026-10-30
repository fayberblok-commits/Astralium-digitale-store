"use client";
/** Audit log viewer (Phase 6, feature 29): append-only admin mutation history. */
import { useEffect, useState } from "react";

interface AuditEntry {
  id: string; actor: string; role: string; action: string; target: string; createdAt: string;
}

export default function AuditPanel({ dict }: { dict: { empty: string } }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    fetch("/api/admin/audit")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEntries(d ? (d.entries as AuditEntry[]) : []))
      .catch(() => setEntries([]));
  }, []);
  if (!entries) return <p className="muted">…</p>;
  if (entries.length === 0) return <p className="muted">{dict.empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="admin-table">
        <thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.actor}</td>
              <td>{e.role}</td>
              <td><code>{e.action}</code></td>
              <td>{e.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
