"use client";
/**
 * Team & access manager (Phase 6, feature 29): account list + create +
 * role changes + delete (owner only — the API enforces it; a 403 here
 * simply renders the honest note), and the signed-in user's own TOTP
 * enrollment: start → secret + otpauth URI (text fallback, no external
 * QR service) → confirm with a live code → backup codes shown ONCE.
 */
import { useCallback, useEffect, useState } from "react";

interface TeamUser { id: string; email: string; role: string; totpEnabled: boolean; createdAt: string }

interface TeamDict {
  email: string;
  role: string;
  add: string;
  twoFa: string;
  enroll: string;
  secret: string;
  codePh: string;
  confirm: string;
  backup: string;
  disable2fa: string;
  delete: string;
  saved: string;
  passwordPh: string;
  ownerOnly: string;
  enabled: string;
}

const ROLES = ["owner", "admin", "manager", "support", "marketer", "accountant", "viewer"];

export default function TeamManager({ dict }: { dict: TeamDict }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState<string | null>(null);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);
  const [enrollUri, setEnrollUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/team");
    if (res.status === 403) { setForbidden(true); return; }
    if (!res.ok) return;
    const data = (await res.json()) as { users: TeamUser[] };
    setUsers(data.users);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch("/api/admin/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  }

  async function create() {
    setError(null);
    const r = await post({ action: "create", email, password, role });
    if (!r.ok) { setError(String(r.data.error ?? "ERROR")); return; }
    setEmail(""); setPassword("");
    void load();
  }

  if (forbidden) return <p className="muted">{dict.ownerOnly}</p>;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead><tr><th>{dict.email}</th><th>{dict.role}</th><th>{dict.twoFa}</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={async (e) => { await post({ action: "setRole", id: u.id, role: e.target.value }); void load(); }}
                    aria-label={dict.role}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td>{u.totpEnabled ? <span className="pill pill-ok">{dict.enabled}</span> : <span className="pill">—</span>}</td>
                <td>
                  <button type="button" className="btn btn-ghost" onClick={async () => { await post({ action: "delete", id: u.id }); void load(); }}>
                    {dict.delete}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <label>{dict.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>{dict.passwordPh}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required /></label>
        <label>{dict.role}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        {error && <p className="err-text" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary">{dict.add}</button>
      </form>

      <h3>{dict.twoFa}</h3>
      {!enrollSecret && !backupCodes && (
        <p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              const r = await post({ action: "enrollStart" });
              if (r.ok) { setEnrollSecret(String(r.data.secret)); setEnrollUri(String(r.data.uri)); }
              else setError(String(r.data.error ?? "ERROR"));
            }}
          >
            {dict.enroll}
          </button>{" "}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => { await post({ action: "disableTotp" }); void load(); }}
          >
            {dict.disable2fa}
          </button>
        </p>
      )}
      {enrollSecret && (
        <div>
          <p className="muted">{dict.secret}:</p>
          <p><code style={{ wordBreak: "break-all" }}>{enrollSecret}</code></p>
          <p><code style={{ wordBreak: "break-all" }}>{enrollUri}</code></p>
          <form className="admin-form" onSubmit={async (e) => {
            e.preventDefault();
            const r = await post({ action: "enrollConfirm", code });
            if (r.ok) {
              setBackupCodes((r.data.backupCodes as string[]) ?? []);
              setEnrollSecret(null);
              void load();
            } else setError(String(r.data.error ?? "ERROR"));
          }}>
            <label>{dict.codePh}<input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required /></label>
            {error && <p className="err-text" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary">{dict.confirm}</button>
          </form>
        </div>
      )}
      {backupCodes && (
        <div>
          <p><strong>{dict.backup}</strong></p>
          <p>{backupCodes.map((c) => <code key={c} style={{ display: "block" }}>{c}</code>)}</p>
        </div>
      )}
    </div>
  );
}
