"use client";
/**
 * Analytics beacon (Phase 6, feature 27). Mounted by the layout ONLY
 * when the `analytics` flag is on. Sends a pageview per route change
 * and registers the global track() sender used for product_view /
 * add_to_cart / checkout_start / purchase events. All sends are
 * fire-and-forget (sendBeacon with fetch fallback); failures are
 * silent by design.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  analyticsConsentGranted, persistentVisitorId, registerTrackSender, type TrackType,
} from "../lib/track-client";

function send(type: TrackType, productId?: string): void {
  try {
    const consent = analyticsConsentGranted();
    // Manager's Office dimensions (Phase 4 upgrade): the traffic source
    // travels as utm_source (when present in the landing URL) and the
    // referrer HOST only — never a full referrer URL (paths/queries can
    // carry other people's data). Device/browser are parsed server-side
    // from the User-Agent; the raw UA is never stored.
    let ref: string | undefined;
    try { ref = document.referrer ? new URL(document.referrer).host : undefined; } catch { ref = undefined; }
    const utm = new URLSearchParams(window.location.search).get("utm_source") ?? undefined;
    const payload = JSON.stringify({
      type,
      productId: productId ?? undefined,
      path: window.location.pathname,
      ...(ref ? { ref } : {}),
      ...(utm ? { utm } : {}),
      ...(consent ? { vid: persistentVisitorId(), vidConsent: true } : {}),
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics/event", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
  } catch {
    // never surface analytics errors to shoppers
  }
}

export default function AnalyticsBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    registerTrackSender((type, data) => send(type, data?.productId));
    return () => registerTrackSender(null);
  }, []);
  useEffect(() => {
    if (pathname) send("pageview");
  }, [pathname]);
  return null;
}
