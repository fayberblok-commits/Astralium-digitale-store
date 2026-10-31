/**
 * HTTP security primitives (Phase 1 upgrade, security §1 + §3).
 *
 * getClientIp — the ONLY way routes learn a client IP. The raw
 * `x-forwarded-for` header is client-spoofable and is NEVER read unless
 * the owner explicitly names it via TRUSTED_PROXY_HEADER. Default trust:
 * Vercel's platform header `x-vercel-forwarded-for`, then `x-real-ip`
 * (also platform-set on Vercel). Behind Cloudflare the owner sets
 * TRUSTED_PROXY_HEADER=cf-connecting-ip.
 *
 * readJsonBody — unified JSON body reader: enforces a byte cap and
 * throws HttpError(400 INVALID_JSON) instead of letting routes crash
 * with a 500 on malformed bodies.
 *
 * assertSameOrigin — CSRF defence-in-depth for state-changing requests
 * (the session cookies are SameSite=Lax already; this rejects cross-site
 * posts even from contexts where cookies might ride along).
 *
 * maskEmail — buyer emails are masked in any response a capability URL
 * (session_id / order id) can unlock (security §7).
 */

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

type HeaderSource = { headers: Headers } | Headers;

function headersOf(src: HeaderSource): Headers {
  return src instanceof Headers ? src : src.headers;
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;

function plausibleIp(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || t.length > 64) return null;
  if (IPV4.test(t) || (IPV6.test(t) && t.includes(":"))) return t;
  return null;
}

/**
 * Resolve the client IP from the configured TRUSTED platform header.
 * When TRUSTED_PROXY_HEADER is set, ONLY that header is consulted
 * (its left-most value when it is a list). Otherwise the default chain
 * is x-vercel-forwarded-for → x-real-ip. Raw x-forwarded-for is read
 * solely when the owner explicitly configures it as the trusted header.
 */
export function getClientIp(src: HeaderSource): string {
  const headers = headersOf(src);
  const trusted = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  if (trusted) {
    const raw = headers.get(trusted);
    const first = raw?.split(",")[0];
    return plausibleIp(first) ?? "unknown";
  }
  for (const name of ["x-vercel-forwarded-for", "x-real-ip"]) {
    const raw = headers.get(name);
    const ip = plausibleIp(raw?.split(",")[0]);
    if (ip) return ip;
  }
  return "unknown";
}

/** Country from the platform header (never from a client-settable source we control less). */
export function getClientCountry(src: HeaderSource): string | undefined {
  const c = headersOf(src).get("cf-ipcountry") ?? headersOf(src).get("x-vercel-ip-country");
  return c && /^[A-Z]{2}$/.test(c) ? c : undefined;
}

// ─── JSON body reading ───────────────────────────────────────────────────────

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * Read and parse a JSON request body with a hard byte cap.
 * Throws HttpError(413 PAYLOAD_TOO_LARGE) or HttpError(400 INVALID_JSON);
 * pair with httpErrorResponse() in the route's catch.
 */
export async function readJsonBody<T = unknown>(
  req: Request,
  opts: { maxBytes?: number } = {},
): Promise<T> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  }
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  }
  if (!text.trim()) throw new HttpError(400, "INVALID_JSON");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON");
  }
}

export function httpErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return new Response(JSON.stringify({ error: err.code }), {
      status: err.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "INTERNAL_ERROR" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Origin / Fetch-Metadata verification (CSRF) ─────────────────────────────

export type OriginVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Verify a state-changing request is same-origin. Browser signals are
 * preferred (Sec-Fetch-Site is not script-settable); Origin is compared
 * against the Host the request actually arrived on. Requests with NO
 * browser signals at all (server-to-server, curl, provider callbacks)
 * are allowed here — they are authenticated by their own secrets
 * (webhook signatures, cron secret, API tokens), and cookies do not
 * ride along on them.
 */
export function verifySameOrigin(req: { headers: Headers; method?: string }): OriginVerdict {
  const headers = req.headers;
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite) {
    if (fetchSite === "cross-site") return { ok: false, reason: "sec-fetch-site:cross-site" };
    if (fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none") {
      return { ok: true };
    }
    return { ok: false, reason: `sec-fetch-site:${fetchSite}` };
  }
  const origin = headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return { ok: false, reason: "origin:unparseable" };
    }
    const host = headers.get("host");
    if (host && originHost !== host) return { ok: false, reason: "origin:host-mismatch" };
    return { ok: true };
  }
  return { ok: true };
}

export function isStateChangingMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

// ─── Output safety ───────────────────────────────────────────────────────────

/** Mask a buyer email for capability-URL responses: "buyer@example.com" → "b***@example.com". */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const shown = local.length <= 1 ? `${local}***` : `${local[0]}***`;
  return `${shown}@${domain}`;
}

/** Escape a string for interpolation into HTML (defence-in-depth alongside React's own escaping). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
