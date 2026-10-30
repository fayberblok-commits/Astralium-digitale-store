"use client";
/**
 * Success-page delivery options (Phase 2). Shows only the channels the
 * server marked available (flag on + provider configured), always offers
 * "Email it to me", and displays the one-time claim code the customer can
 * type into WhatsApp / Messenger / Instagram instead of tapping a link.
 */
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";

export interface DeliveryLinks {
  whatsapp?: string;
  messenger?: string;
  instagram?: string;
}

export default function DeliveryOptions({
  dict,
  sessionId,
  claimCode,
  links,
}: {
  dict: Dict;
  sessionId?: string;
  claimCode?: string;
  links: DeliveryLinks;
}) {
  const [emailState, setEmailState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const hasSocial = Boolean(links.whatsapp || links.messenger || links.instagram);

  async function emailMe() {
    if (!sessionId) return;
    setEmailState("busy");
    try {
      const res = await fetch("/api/delivery/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setEmailState(res.ok ? "sent" : "error");
    } catch {
      setEmailState("error");
    }
  }

  return (
    <div style={{ marginTop: 26 }}>
      <h2>{dict.success_receive_title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 480, margin: "12px auto 0" }}>
        {links.whatsapp && (
          <a className="btn" href={links.whatsapp} target="_blank" rel="noreferrer">
            {dict.success_receive_whatsapp}
          </a>
        )}
        {links.messenger && (
          <a className="btn" href={links.messenger} target="_blank" rel="noreferrer">
            {dict.success_receive_messenger}
          </a>
        )}
        {links.instagram && (
          <a className="btn" href={links.instagram} target="_blank" rel="noreferrer">
            {dict.success_receive_instagram}
          </a>
        )}
        {sessionId && (
          <button type="button" className="btn btn-primary" disabled={emailState === "busy" || emailState === "sent"} onClick={() => void emailMe()}>
            {emailState === "sent" ? dict.success_email_sent : dict.success_email_btn}
          </button>
        )}
      </div>
      {hasSocial && claimCode && (
        <div style={{ marginTop: 18 }}>
          <p className="muted" style={{ marginBottom: 6 }}>{dict.success_claim_label}</p>
          <p style={{ fontSize: "1.3rem", letterSpacing: "0.12em", margin: 0 }}>
            <strong>{claimCode}</strong>
          </p>
          <p className="muted">{dict.success_claim_hint}</p>
        </div>
      )}
    </div>
  );
}
