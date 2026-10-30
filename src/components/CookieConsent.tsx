"use client";
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";

export default function CookieConsent({ dict }: { dict: Dict }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem("astralium-consent")) setVisible(true);
  }, []);
  if (!visible) return null;
  const choose = (v: string) => {
    localStorage.setItem("astralium-consent", v);
    // Phase 6 (features 27/30): mirror the choice into the consent
    // cookie the analytics endpoint + privacy center read server-side.
    try {
      const prefs = JSON.stringify({ analytics: v === "all", marketing: v === "all" });
      document.cookie = `astralium-consent=${encodeURIComponent(prefs)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch { /* cookie write is best-effort */ }
    setVisible(false);
  };
  return (
    <div className="cookie-banner" role="dialog" aria-live="polite">
      <p>{dict.cookie_text}</p>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={() => choose("all")}>
          {dict.cookie_accept}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => choose("essential")}>
          {dict.cookie_decline}
        </button>
      </div>
    </div>
  );
}
