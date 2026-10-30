"use client";
/**
 * License verify/activate form (Phase 5, feature 18). Talks to the
 * public, rate-limited /api/license/* endpoints and renders the
 * distinct verdict codes with dictionary strings.
 */
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";

interface Verdict {
  valid: boolean;
  code: string;
  activationsUsed?: number;
  activationLimit?: number;
  alreadyActivated?: boolean;
}

export default function LicenseClient({ dict }: { dict: Dict }) {
  const [key, setKey] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  async function call(path: "verify" | "activate") {
    if (!key.trim()) return;
    setBusy(true);
    setRateLimited(false);
    setVerdict(null);
    try {
      const res = await fetch(`/api/license/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(path === "verify" ? { key } : { key, deviceId }),
      });
      if (res.status === 429) {
        setRateLimited(true);
        return;
      }
      if (res.ok) setVerdict((await res.json()) as Verdict);
      else setVerdict({ valid: false, code: "KEY_NOT_FOUND" });
    } catch {
      setVerdict({ valid: false, code: "KEY_NOT_FOUND" });
    } finally {
      setBusy(false);
    }
  }

  const message = rateLimited
    ? dict.license_rate_limited
    : verdict == null
      ? null
      : verdict.code === "OK"
        ? `${dict.license_ok}${verdict.activationLimit ? ` · ${verdict.activationsUsed ?? 0}/${verdict.activationLimit} ${dict.license_activations}` : ""}${verdict.alreadyActivated ? ` · ${dict.license_already}` : ""}`
        : verdict.code === "KEY_REVOKED"
          ? dict.license_revoked
          : verdict.code === "ACTIVATION_LIMIT_REACHED"
            ? dict.license_limit
            : dict.license_not_found;

  return (
    <div className="panel" style={{ marginTop: 20, maxWidth: 560 }}>
      <label>
        {dict.license_key_label}
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={dict.license_key_ph}
          autoComplete="off"
          spellCheck={false}
          style={{ width: "100%" }}
        />
      </label>
      <label>
        {dict.license_device_label}
        <input
          type="text"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder={dict.license_device_ph}
          autoComplete="off"
          spellCheck={false}
          style={{ width: "100%" }}
        />
      </label>
      <p style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void call("verify")}>
          {dict.license_verify_btn}
        </button>
        <button type="button" className="btn" disabled={busy || !deviceId.trim()} onClick={() => void call("activate")}>
          {dict.license_activate_btn}
        </button>
      </p>
      {message && (
        <p role="status" className={verdict?.valid ? "ok-text" : "muted"}>
          {message}
        </p>
      )}
    </div>
  );
}
