"use client";
/**
 * Admin "Security center" panel (Phase 1 upgrade, §4/§13):
 *  - owner TOTP enrollment (start → confirm with code → backup codes
 *    shown exactly once), disable behind step-up,
 *  - step-up verification (password + TOTP → 5-minute elevated window),
 *  - terminate-all-sessions,
 *  - the recent security audit events + locked accounts.
 * All calls go to /api/admin/security* which enforce permissions
 * server-side; this panel only renders what the API allows.
 */
import { useCallback, useEffect, useState } from "react";

export interface SecurityDict {
  title: string;
  desc: string;
  events: string;
  empty: string;
  epoch: string;
  totpTitle: string;
  totpOn: string;
  totpOff: string;
  totpBegin: string;
  totpSecret: string;
  totpCode: string;
  totpConfirm: string;
  totpBackup: string;
  totpDisable: string;
  stepup: string;
  stepupDone: string;
  terminate: string;
  terminateDone: string;
  locked: string;
  password: string;
}

interface SecurityState {
  epoch: number;
  ownerTotp: { enrolled: boolean; required: boolean };
  lockedAccounts: { key: string; failures: number; lockedUntil: number | null }[];
  events: { id: string; ts: string; kind: string; actor: string | null; ip: string | null; detail?: Record<string, unknown> }[];
}

export default function SecurityPanel({ dict }: { dict: SecurityDict }) {
  const [state, setState] = useState<SecurityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/security");
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }
    setState((await res.json()) as SecurityState);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
      return null;
    }
    setError(null);
    return data;
  }

  async function beginTotp() {
    const data = await post("/api/admin/security/totp", { action: "start" });
    if (data && typeof data.secret === "string") setSecret(data.secret);
  }

  async function confirmTotp() {
    const data = await post("/api/admin/security/totp", { action: "confirm", code });
    if (data) {
      setBackupCodes((data.backupCodes as string[]) ?? []);
      setSecret(null);
      setCode("");
      void load();
    }
  }

  async function disableTotp() {
    const data = await post("/api/admin/security/totp", { action: "disable" });
    if (data) void load();
  }

  async function stepUp() {
    const data = await post("/api/admin/step-up", { password, code: code || undefined });
    if (data) {
      setNotice(dict.stepupDone);
      setPassword("");
    }
  }

  async function terminateAll() {
    const res = await fetch("/api/admin/session/terminate-all", { method: "POST" });
    if (res.ok) {
      setNotice(dict.terminateDone);
      void load();
    } else {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? `HTTP ${res.status}`);
    }
  }

  return (
    <div className="panel">
      <p className="muted">{dict.desc}</p>
      {error ? <p><span className="pill pill-bad">{error}</span></p> : null}
      {notice ? <p><span className="pill">{notice}</span></p> : null}

      <h3>{dict.totpTitle}</h3>
      {state?.ownerTotp.enrolled ? (
        <>
          <p>{dict.totpOn}</p>
          <button type="button" onClick={() => void disableTotp()}>{dict.totpDisable}</button>
        </>
      ) : (
        <>
          <p>{dict.totpOff}</p>
          {!secret ? (
            <button type="button" onClick={() => void beginTotp()}>{dict.totpBegin}</button>
          ) : (
            <>
              <p>{dict.totpSecret}: <code>{secret}</code></p>
              <label>
                {dict.totpCode}{" "}
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
              </label>{" "}
              <button type="button" onClick={() => void confirmTotp()}>{dict.totpConfirm}</button>
            </>
          )}
        </>
      )}
      {backupCodes ? (
        <div>
          <p>{dict.totpBackup}</p>
          <ul>{backupCodes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        </div>
      ) : null}

      <h3>{dict.stepup}</h3>
      <label>
        {dict.password}{" "}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </label>{" "}
      <label>
        {dict.totpCode}{" "}
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
      </label>{" "}
      <button type="button" onClick={() => void stepUp()}>{dict.stepup}</button>

      <h3>{dict.terminate}</h3>
      <p className="muted">{dict.epoch}: {state?.epoch ?? "—"}</p>
      <button type="button" onClick={() => void terminateAll()}>{dict.terminate}</button>

      <h3>{dict.locked}</h3>
      {state && state.lockedAccounts.length > 0 ? (
        <ul>
          {state.lockedAccounts.map((a) => (
            <li key={a.key}><code>{a.key}</code> — {a.failures}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">—</p>
      )}

      <h3>{dict.events}</h3>
      {state && state.events.length > 0 ? (
        <ul>
          {state.events.map((e) => (
            <li key={e.id}>
              <code>{e.ts}</code> — <strong>{e.kind}</strong>
              {e.actor ? <> · {e.actor}</> : null}
              {e.ip ? <> · {e.ip}</> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{dict.empty}</p>
      )}
    </div>
  );
}
