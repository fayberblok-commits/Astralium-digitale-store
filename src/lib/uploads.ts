/**
 * Upload policy for product files: allowed deliverable extensions,
 * filename sanitisation, and the declared-size cap (5 GB per object —
 * enforced here on the declared size; the bucket should also carry a
 * lifecycle/policy limit as defence in depth).
 */
export const ALLOWED_EXTENSIONS = [
  "pdf",
  "zip",
  "mp3",
  "mp4",
  "epub",
  "mobi",
  "png",
  "jpg",
  "wav",
  "flac",
];

export const MAX_DECLARED_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Reduce a user-supplied filename to a safe S3 basename:
 * strips any path, removes leading dots, collapses unsafe characters,
 * and rejects extensions outside the allowlist. Returns null if unusable.
 */
export function sanitizeFilename(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/-{2,}/g, "-");
  if (!cleaned || cleaned.length > 120 || !cleaned.includes(".")) return null;
  const ext = cleaned.split(".").pop()!.toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) return null;
  return cleaned;
}
