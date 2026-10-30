/**
 * Free previews (Phase 3, feature 2) — pure helpers.
 *
 * Previews live in the separate `previews/` storage namespace and are
 * served through GET /api/preview/[productId], which 302-redirects to a
 * short-lived presigned URL. Oversized preview objects are refused: the
 * route HEAD-checks the object against PREVIEW_MAX_MB (default 25 MB).
 * When storage is not configured, the route serves the product's built-in
 * preview text as a small formatted sample document instead.
 */
import type { Product } from "../data/products";

export function previewMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.PREVIEW_MAX_MB);
  const safe = Number.isFinite(mb) && mb > 0 ? mb : 25;
  return Math.floor(safe * 1024 * 1024);
}

/** True when a preview object of `contentLength` bytes may be served. */
export function previewSizeAllowed(contentLength: number | undefined, maxBytes: number): boolean {
  if (contentLength === undefined || !Number.isFinite(contentLength)) return false;
  return contentLength <= maxBytes;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Audio formats get an <audio> player in the product page preview block. */
export function isAudioProduct(product: Product): boolean {
  return product.formats.some((f) => /mp3|wav|flac|m4b|audio/i.test(f.format));
}

/**
 * The no-storage fallback: the catalog preview text rendered as a small,
 * self-contained sample document (used in an <iframe> on the product page).
 */
export function buildPreviewFallbackDoc(product: Product): string {
  const structure = product.formats
    .map((f) => `<li>${escapeHtml(f.format)} — ${f.sizeMB >= 1000 ? `${(f.sizeMB / 1000).toFixed(1)} GB` : `${f.sizeMB} MB`}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Preview — ${escapeHtml(product.title)}</title>
<style>body{font-family:Georgia,serif;background:#f6f1e7;color:#171512;margin:0;padding:28px;line-height:1.65}
h1{font-size:1.35rem;margin:0 0 4px}.sub{color:#6b6252;margin:0 0 18px}.rule{border-top:3px double #a8842c;margin:18px 0}
.wm{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:#a8842c}</style></head>
<body><p class="wm">Astralium — free preview</p><h1>${escapeHtml(product.title)}</h1>
<p class="sub">${escapeHtml(product.subtitle)}</p><div class="rule"></div>
<p>${escapeHtml(product.preview)}</p><div class="rule"></div>
<p><strong>Full product structure</strong></p><ul>${structure}</ul>
<p class="sub">This sample is generated from the catalog preview text because file storage is not configured on this deployment.</p>
</body></html>`;
}
