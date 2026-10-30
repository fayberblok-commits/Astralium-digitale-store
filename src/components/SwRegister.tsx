"use client";
import { useEffect } from "react";

/**
 * Registers the service worker ONLY when the pwa_push flag is on
 * (Phase 6, feature 28) — the layout passes `enabled`. With the flag
 * off the store ships no SW behaviour at all.
 */
export default function SwRegister({ enabled = false }: { enabled?: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* PWA is progressive enhancement — never break the store for it. */
      });
    }
  }, [enabled]);
  return null;
}
