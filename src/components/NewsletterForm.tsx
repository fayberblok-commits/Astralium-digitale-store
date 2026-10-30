"use client";
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";

export default function NewsletterForm({ dict }: { dict: Dict }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "ok" | "bad" | "busy">("idle");
  return (
    <form
      className="newsletter-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        try {
          const res = await fetch("/api/newsletter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          setState(res.ok ? "ok" : "bad");
        } catch {
          setState("bad");
        }
      }}
    >
      <label className="visually-hidden" htmlFor="newsletter-email">Email</label>
      <input
        id="newsletter-email"
        type="email"
        required
        placeholder={dict.email_ph}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={state === "busy"}>
        {state === "busy" ? dict.processing : dict.newsletter_btn}
      </button>
      {state === "ok" && <p className="ok-text" role="status">{dict.newsletter_ok}</p>}
      {state === "bad" && <p className="err-text" role="alert">{dict.newsletter_bad}</p>}
    </form>
  );
}
