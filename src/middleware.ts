import { NextRequest, NextResponse } from "next/server";
import { LOCALE_CODES, isLocale, matchLocale } from "./i18n/locales";

/**
 * Edge middleware — three jobs:
 *
 * 1. Locale prefixing (unchanged behaviour): unprefixed page paths
 *    redirect to /{locale}… from cookie/Accept-Language.
 *
 * 2. Strict CSP with a per-request nonce (Phase 1 upgrade, §2). The
 *    nonce travels in the `x-nonce` request header (server components
 *    read it to nonce their inline scripts) and in the response CSP.
 *    Only Stripe/PayPal/captcha origins the store actually uses are
 *    allow-listed.
 *
 * 3. CSRF origin verification for state-changing API calls (§3) and
 *    the env-configured admin path (§6): when ADMIN_PATH is set, the
 *    admin UI answers ONLY there and the default segment 404s.
 *    Webhooks (provider-signed) and cron jobs (secret-header) are
 *    exempt — they authenticate with their own credentials and are not
 *    cookie-bearing browser flows.
 */

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/", "/api/jobs/"];

function buildCsp(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com https://checkout.stripe.com https://api-m.paypal.com https://api-m.sandbox.paypal.com https://api.openai.com https://api.resend.com https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com",
    "frame-src https://checkout.stripe.com https://www.paypal.com https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com",
    "form-action 'self' https://checkout.stripe.com https://www.paypal.com",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ].join("; ");
}

/** Inline copy of the §3 origin logic (edge runtime: no Node imports). */
function crossSiteRequest(req: NextRequest): boolean {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "cross-site";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("host");
    return host !== null && new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function adminSegment(): string {
  const raw = (process.env.ADMIN_PATH ?? "").trim().replace(/^\/+|\/+$/g, "");
  return /^[a-z0-9][a-z0-9-]{2,60}$/.test(raw) ? raw : "control-astralium";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── API: CSRF gate for state-changing calls, then pass through ──────────
  if (pathname.startsWith("/api")) {
    if (
      STATE_CHANGING.has(req.method) &&
      !CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p)) &&
      crossSiteRequest(req)
    ) {
      console.warn(JSON.stringify({ event: "csrf.rejected", path: pathname, method: req.method }));
      return NextResponse.json({ error: "CSRF_REJECTED" }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Next internals and static files pass through untouched.
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0] ?? "";

  const finalize = (res: NextResponse, isAdmin: boolean): NextResponse => {
    res.headers.set("Content-Security-Policy", csp);
    if (isAdmin) res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  };

  if (isLocale(first)) {
    const second = segments[1] ?? "";
    const adminPath = adminSegment();
    // Env admin path (§6): rewrite the configured segment onto the real
    // route; the default segment 404s when a custom one is configured.
    if (adminPath !== "control-astralium") {
      if (second === "control-astralium") {
        return finalize(new NextResponse("Not Found", { status: 404 }), true);
      }
      if (second === adminPath) {
        const url = req.nextUrl.clone();
        url.pathname = `/${first}/control-astralium${segments.length > 2 ? `/${segments.slice(2).join("/")}` : ""}`;
        return finalize(NextResponse.rewrite(url, { request: { headers: requestHeaders } }), true);
      }
    }
    const isAdmin = second === "control-astralium" || second === adminPath;
    return finalize(NextResponse.next({ request: { headers: requestHeaders } }), isAdmin);
  }

  const cookieLocale = req.cookies.get("astralium-locale")?.value;
  const locale =
    cookieLocale && isLocale(cookieLocale)
      ? cookieLocale
      : matchLocale(req.headers.get("accept-language"));

  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return finalize(NextResponse.redirect(url), false);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export { LOCALE_CODES };
