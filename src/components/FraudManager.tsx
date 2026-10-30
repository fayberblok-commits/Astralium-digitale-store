"use client";
/** Admin fraud-shield review queue + blacklist (Phase 5, feature 19). */
import { useCallback, useEffect, useState } from "react";

export interface FraudDict {
  threshold: string; save: string; saved: string; empty: string;
  release: string; reject: string; score: string; reasons: string;
  blacklist: string; blacklistPh: string; add: string; remove: string;
  rejectNote: string; queue: string;
}

interface Hold {
  id: string; orderId: string; emailHashPrefix: string; score: number;
  reasons: string[]; status: string; createdAt: string; emailable: boolean;
}

interface BlacklistEntry { id: string; emailHashPrefix: string; reason: string; createdAt: string }

export default function FraudManager({ dict }: { dict: FraudDict }) {
  const [holds, setHolds] = useState<Hold[]>([]);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [threshold, setThreshold] = useState(60);
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/fraud");
      if (!res.ok) return;
      const data = (await res.json()) as {
        config: { threshold: number }; holds: Hold[]; blacklist: BlacklistEntry[];
      };
      setHolds(data.holds);
      setBlacklist(data.blacklist);
      setThreshold(data.config.threshold);
    } catch { /* empty state renders */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    await fetch("/api/admin/fraud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    void load();
  }

  const pending = holds.filter((h) => h.status === "pending");
  const resolved = holds.filter((h) => h.status !== "pending");

  return (
    <div>
      <p>
        <label>
          {dict.threshold}{" "}
          <input
            type="number" min={10} max={100} value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </label>{" "}
        <button
          type="button" className="btn btn-primary"
          onClick={() => { void post({ action: "config", threshold }).then(() => setSaved(true)); }}
        >
          {dict.save}
        </button>
        {saved ? <span className="ok-text"> ✓ {dict.saved}</span> : null}
      </p>

      <h3>{dict.queue}</h3>
      {pending.length === 0 ? (
        <p className="empty-note">{dict.empty}</p>
      ) : (
        pending.map((h) => (
          <article key={h.id} className="panel" style={{ marginBottom: 10 }}>
            <p>
              <strong>{h.orderId}</strong> · {dict.score}: <strong>{h.score}</strong> ·{" "}
              <span className="muted">{dict.reasons}: {h.reasons.join(", ") || "—"}</span>
            </p>
            <p className="muted">{new Date(h.createdAt).toLocaleString()} · email #{h.emailHashPrefix}…</p>
            <p style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={() => void post({ action: "release", id: h.id })}>
                {dict.release}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void post({ action: "reject", id: h.id })}>
                {dict.reject}
              </button>
            </p>
          </article>
        ))
      )}
      {resolved.length > 0 && (
        <p className="muted">
          {resolved.map((h) => `${h.orderId}: ${h.status}`).join(" · ")}
        </p>
      )}
      <p className="muted">{dict.rejectNote}</p>

      <h3>{dict.blacklist}</h3>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder={dict.blacklistPh} style={{ minWidth: 260 }}
        />
        <button
          type="button" className="btn"
          onClick={() => { void post({ action: "blacklist-add", email }).then(() => setEmail("")); }}
        >
          {dict.add}
        </button>
      </p>
      {blacklist.length > 0 && (
        <table className="admin-table">
          <tbody>
            {blacklist.map((b) => (
              <tr key={b.id}>
                <td>#{b.emailHashPrefix}…</td>
                <td>{b.reason || "—"}</td>
                <td>{new Date(b.createdAt).toLocaleDateString()}</td>
                <td>
                  <button type="button" className="btn btn-ghost" onClick={() => void post({ action: "blacklist-remove", id: b.id })}>
                    {dict.remove}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
