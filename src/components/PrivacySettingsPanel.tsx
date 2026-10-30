"use client";
/** Privacy retention settings (Phase 6, feature 30): retention days applied by the cleanup job. */
import { useEffect, useState } from "react";

export default function PrivacySettingsPanel({ dict }: { dict: { retention: string; save: string; saved: string } }) {
  const [days, setDays] = useState(365);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/admin/privacy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDays(Number((d.config as { retentionDays: number }).retentionDays)); })
      .catch(() => undefined);
  }, []);
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await fetch("/api/admin/privacy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { retentionDays: days } }),
        });
        setSaved(res.ok);
        if (res.ok) setTimeout(() => setSaved(false), 2500);
      }}
    >
      <label>
        {dict.retention}
        <input
          type="number"
          min={7}
          max={3650}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
      </label>
      <button type="submit" className="btn btn-primary">{saved ? dict.saved : dict.save}</button>
    </form>
  );
}
