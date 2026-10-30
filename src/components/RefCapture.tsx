"use client";
/**
 * Referral first-touch capture (Phase 4, feature 12): when a visitor
 * lands with ?ref=CODE and has NO attribution cookie yet, store the
 * code for 30 days. An existing cookie is never overwritten (first
 * touch wins). Renders nothing.
 */
import { useEffect } from "react";

// Mirrors REF_COOKIE_NAME / REF_TTL_DAYS in src/lib/referrals.ts —
// duplicated here because that module is server-only (fs/Prisma).
const REF_COOKIE_NAME = "astralium-ref";
const REF_TTL_DAYS = 30;

export default function RefCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (!ref) return;
      const has = document.cookie.split(";").some((c) => c.trim().startsWith(`${REF_COOKIE_NAME}=`));
      if (has) return; // first-touch: never overwrite
      const maxAge = REF_TTL_DAYS * 24 * 3600;
      document.cookie = `${REF_COOKIE_NAME}=${encodeURIComponent(ref)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
    } catch {
      // cookies unavailable — attribution is simply skipped
    }
  }, []);
  return null;
}
