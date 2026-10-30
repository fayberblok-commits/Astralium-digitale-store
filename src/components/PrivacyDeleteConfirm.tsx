"use client";
/**
 * Deletion confirmation (Phase 6, feature 30): the token page for a
 * `delete` privacy request. Nothing is deleted until the visitor ticks
 * the confirmation box and presses the button (a POST — email scanners
 * and prefetchers following the GET link change nothing).
 */
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";

export default function PrivacyDeleteConfirm({ dict, token }: { dict: Dict; token: string }) {
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (done) return <p role="status">{dict.pc_delete_done}</p>;
  return (
    <div>
      <p>{dict.pc_delete_confirm_d}</p>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        {dict.pc_delete_warn}
      </label>
      <p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!confirm || busy}
          onClick={async () => {
            setBusy(true);
            setError(false);
            try {
              const res = await fetch("/api/privacy/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, confirm: true }),
              });
              if (res.ok) setDone(true);
              else setError(true);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {dict.pc_delete_execute}
        </button>
        {error && <> <span className="pill pill-bad">{dict.pc_token_invalid}</span></>}
      </p>
    </div>
  );
}
