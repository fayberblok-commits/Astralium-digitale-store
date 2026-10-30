"use client";
/**
 * A/B test beacon (Phase 5, feature 23). Rendered only when the
 * `ab_tests` flag is on. Ensures the anonymous visitor cookie exists
 * (random id, no PII, 1 year, SameSite=Lax), then reports the event
 * type to /api/ab/event — the server computes the variant itself, so
 * nothing about the assignment is trusted from the client.
 */
import { useEffect } from "react";

const COOKIE = "astralium-vid";

function ensureVisitorId(): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (match) return decodeURIComponent(match[1]);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  document.cookie = `${COOKIE}=${id}; path=/; max-age=${365 * 24 * 3600}; SameSite=Lax`;
  return id;
}

export default function AbBeacon({ mode }: { mode: "exposure" | "conversion" }) {
  useEffect(() => {
    ensureVisitorId();
    void fetch("/api/ab/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: mode }),
      keepalive: true,
    }).catch(() => { /* analytics must never break the page */ });
  }, [mode]);
  return null;
}
