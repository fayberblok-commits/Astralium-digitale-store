/**
 * PayPal JS SDK — shared loading machinery (speed fix, register
 * item 81, 2026-11).
 *
 * The complaint: on the checkout page the PayPal buttons area and
 * the card-fields area sat dead for ~5 s on a slow connection. The
 * chain used to be fully serial and started only after hydration:
 *   page render → React hydration → effect → cold DNS/TLS to
 *   www.paypal.com → 102 KB SDK loader (+ chunks) → Buttons iframe
 *   → FOUR card-field iframes rendered one await at a time.
 * This module breaks the chain up:
 *  - `paypalSdkUrl` is the ONE place the SDK URL is built, so the
 *    server checkout page can render the exact same <script> tag
 *    into the HTML and the download starts during parsing, in
 *    parallel with our own bundles;
 *  - `loadPaypalSdk` ADOPTS a tag already in the document (server-
 *    rendered or warmed) instead of downloading the SDK twice;
 *  - `warmUpPaypal` runs on purchase intent (hover/focus/tap on the
 *    PayPal express button): it warms the network path (preconnect),
 *    fetches the Card Fields client token into a session cache, and
 *    loads the SDK with that token, so arrival at checkout finds
 *    `window.paypal` ready.
 * The token cache is a warm-up optimisation ONLY: the checkout page
 * still ships its own server-minted token, which stays authoritative
 * (the loader prefers an already-loaded namespace, and the warmed
 * token is a genuine server-minted one from /api/paypal/client-token).
 */

export interface PaypalButtonsInstance {
  render: (selector: string | HTMLElement) => Promise<void>;
  close: () => void;
}
export interface PaypalCardFieldComponent {
  render: (selector: string | HTMLElement) => Promise<void>;
}
export interface PaypalCardFieldsInstance {
  isEligible: () => boolean;
  NameField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  NumberField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  ExpiryField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  CVVField: (opts?: { placeholder?: string }) => PaypalCardFieldComponent;
  submit: () => Promise<void>;
}
export interface PaypalNamespace {
  Buttons: (config: Record<string, unknown>) => PaypalButtonsInstance;
  CardFields?: (config: Record<string, unknown>) => PaypalCardFieldsInstance;
}
declare global {
  interface Window {
    paypal?: PaypalNamespace;
  }
}

/** The exact SDK URL the checkout has always loaded — one builder,
 *  shared by the server-rendered tag and the client loader so the
 *  two can never drift (the loader adopts tags by this src). */
export function paypalSdkUrl(clientId: string): string {
  return (
    `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
    `&components=buttons,card-fields&currency=USD&intent=capture`
  );
}

/* ── client-token session cache (browser only; guarded) ─────────── */

const TOKEN_KEY = "astralium-pp-token";
/** Treat a cached token as dead this long before its stored expiry. */
export const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/** Conservative cache lifetime when PayPal gives us no expiry: far
 *  inside any real client-token lifetime, and the checkout page's
 *  fresh server-minted token supersedes the cache on arrival. */
const TOKEN_FALLBACK_TTL_MS = 10 * 60_000;

/** Pure freshness rule for a cached token entry — pinned by tests. */
export function cachedTokenFresh(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && expiresAt - TOKEN_EXPIRY_MARGIN_MS > now;
}

export function readCachedClientToken(now: number = Date.now()): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: number };
    if (!parsed.token || typeof parsed.expiresAt !== "number") return null;
    return cachedTokenFresh(parsed.expiresAt, now) ? parsed.token : null;
  } catch {
    return null; // no sessionStorage (server, privacy mode) → no cache
  }
}

export function storeCachedClientToken(
  token: string,
  expiresInSec?: number | null,
  now: number = Date.now(),
): void {
  const ttlMs =
    typeof expiresInSec === "number" && expiresInSec > 0
      ? expiresInSec * 1000
      : TOKEN_FALLBACK_TTL_MS;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: now + ttlMs }));
  } catch { /* cache is best-effort */ }
}

let tokenFetchInFlight: Promise<string | null> | null = null;

/** Fetch the client token from our own API, session-cached. Repeat
 *  visits to checkout (and repeat intent hovers) never re-fetch
 *  while a fresh cached token exists. Null on any failure — the
 *  degraded path is Smart Buttons only, exactly as before. */
export function fetchClientTokenCached(): Promise<string | null> {
  const cached = readCachedClientToken();
  if (cached) return Promise.resolve(cached);
  if (tokenFetchInFlight) return tokenFetchInFlight;
  tokenFetchInFlight = (async () => {
    try {
      const res = await fetch("/api/paypal/client-token");
      if (!res.ok) return null;
      const data = (await res.json()) as { clientToken?: string; expiresIn?: number };
      if (!data.clientToken) return null;
      storeCachedClientToken(data.clientToken, data.expiresIn);
      return data.clientToken;
    } catch {
      return null;
    } finally {
      tokenFetchInFlight = null;
    }
  })();
  return tokenFetchInFlight;
}

/* ── the SDK loader (adopts existing tags) ──────────────────────── */

const sdkLoads = new Map<string, Promise<PaypalNamespace>>();

export function loadPaypalSdk(
  clientId: string,
  clientToken?: string | null,
): Promise<PaypalNamespace> {
  // Card Fields need the server-minted client token ON the script
  // tag (data-client-token); without it paypal.CardFields stays
  // undefined. The token is part of the cache key so a tokenised
  // load never reuses a token-less one (or vice versa).
  const cacheKey = clientToken ? `${clientId}#${clientToken}` : clientId;
  const existing = sdkLoads.get(cacheKey);
  if (existing) return existing;
  const promise = new Promise<PaypalNamespace>((resolve, reject) => {
    if (window.paypal?.Buttons) {
      resolve(window.paypal);
      return;
    }
    const finish = () => {
      if (window.paypal?.Buttons) resolve(window.paypal);
      else reject(new Error("paypal-sdk-incomplete"));
    };
    // Adopt a tag already in the document — rendered by the server
    // into the checkout HTML, or injected by an intent warm-up —
    // instead of downloading the SDK a second time.
    const src = paypalSdkUrl(clientId);
    const tag = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (tag) {
      tag.addEventListener("load", finish);
      tag.addEventListener("error", () => {
        tag.remove(); // a dead tag must not be re-adopted by a retry
        reject(new Error("paypal-sdk-load-failed"));
      });
      // The tag may have completed in the gap before listeners were
      // attached (its load event already fired → window.paypal set).
      if (window.paypal?.Buttons) resolve(window.paypal);
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    if (clientToken) script.setAttribute("data-client-token", clientToken);
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error("paypal-sdk-load-failed"));
    document.head.appendChild(script);
  });
  // A failed load must not poison later attempts (e.g. transient network).
  promise.catch(() => sdkLoads.delete(cacheKey));
  sdkLoads.set(cacheKey, promise);
  return promise;
}

/* ── purchase-intent warm-up ────────────────────────────────────── */

let warmState: "idle" | "working" | "done" = "idle";

/**
 * Warm the payment path before the buyer reaches checkout: open the
 * network path to PayPal's origins, fetch + session-cache the Card
 * Fields client token, and load the SDK with it. Called from the
 * PayPal express button on hover/focus/tap. Idempotent; a failed
 * attempt re-arms so a later intent can retry. The SDK is only
 * loaded once a token is in hand — a token-less warm load would
 * leave a Card-Fields-less `window.paypal` behind and poison the
 * real checkout load.
 */
export function warmUpPaypal(clientId?: string | null): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  for (const href of ["https://www.paypal.com", "https://www.paypalobjects.com"]) {
    if (!document.querySelector(`link[rel="preconnect"][href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = href;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  }
  if (!clientId || warmState !== "idle") return;
  warmState = "working";
  void (async () => {
    const token = await fetchClientTokenCached();
    if (!token) {
      warmState = "idle";
      return;
    }
    const ok = await loadPaypalSdk(clientId, token).then(
      () => true,
      () => false,
    );
    warmState = ok ? "done" : "idle";
  })();
}
