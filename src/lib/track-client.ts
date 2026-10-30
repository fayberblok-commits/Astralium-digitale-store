/**
 * Client-side analytics dispatch (Phase 6, feature 27).
 *
 * A tiny registry: AnalyticsBeacon registers the real sender when the
 * `analytics` flag is on; every other component calls track() which
 * no-ops silently when no sender is registered (flag off, beacon not
 * mounted, SSR). Consent: the persistent visitor id is only attached
 * when the visitor's stored consent says analytics is allowed; the
 * consent cookie is also honoured server-side (defense in depth).
 */
export type TrackType = "pageview" | "product_view" | "add_to_cart" | "checkout_start" | "purchase";

type Sender = (type: TrackType, data?: { productId?: string }) => void;

let sender: Sender | null = null;

export function registerTrackSender(fn: Sender | null): void {
  sender = fn;
}

export function track(type: TrackType, data?: { productId?: string }): void {
  try {
    sender?.(type, data);
  } catch {
    // analytics must never break shopping
  }
}

export function analyticsConsentGranted(): boolean {
  try {
    const raw = localStorage.getItem("astralium-consent");
    if (raw === "all") return true;
    if (raw === "essential") return false;
    const cookie = document.cookie.match(/(?:^|;\s*)astralium-consent=([^;]+)/);
    if (cookie) {
      const parsed = JSON.parse(decodeURIComponent(cookie[1])) as { analytics?: boolean };
      return parsed.analytics === true;
    }
  } catch {
    // fall through
  }
  return false;
}

export function persistentVisitorId(): string {
  const KEY = "astralium-anon-id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(KEY, id);
  }
  return id;
}
