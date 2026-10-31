/**
 * Magic-byte content verification (Phase 1 upgrade, security §9).
 *
 * An upload's DECLARED type (extension / client MIME) is attacker-
 * controlled; the BYTES are not. Before a stored object may be bound
 * to a product (admin files confirm), the object's first bytes must
 * match the signature of the format its extension claims. A mismatch
 * means the object is deleted and never becomes deliverable.
 *
 * Pure module (no imports) so the penetration/unit suites import it
 * exactly as shipped.
 */

export type SniffedKind =
  | "pdf"
  | "zip" // zip, epub, docx, xlsx, jar… (container formats)
  | "mp3"
  | "mp4"
  | "png"
  | "jpeg"
  | "wav"
  | "flac"
  | "mobi"
  | "text"
  | "unknown";

/** Extensions the store accepts for product files, mapped to kinds. */
export const EXTENSION_KIND: Record<string, SniffedKind> = {
  pdf: "pdf",
  zip: "zip",
  epub: "zip",
  docx: "zip",
  xlsx: "zip",
  mp3: "mp3",
  mp4: "mp4",
  m4a: "mp4",
  m4v: "mp4",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  wav: "wav",
  flac: "flac",
  mobi: "mobi",
  txt: "text",
  md: "text",
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < Math.min(to, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Identify a buffer's real format from its leading bytes. */
export function sniffBytes(bytes: Uint8Array): SniffedKind {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return "zip"; // PK..
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(bytes, 0, 4) === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3"; // MPEG frame sync
  if (ascii(bytes, 4, 8) === "ftyp") return "mp4";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return "wav";
  if (ascii(bytes, 0, 4) === "fLaC") return "flac";
  if (ascii(bytes, 60, 68) === "BOOKMOBI") return "mobi";
  // Plain text: no NUL bytes and decodable-looking ASCII/UTF-8 start.
  const head = bytes.subarray(0, Math.min(bytes.length, 512));
  if (head.length > 0 && !head.includes(0)) return "text";
  return "unknown";
}

/**
 * Verify that `bytes` really are the format `extension` claims.
 * Returns ok:false with a reason for unknown extensions and mismatches.
 */
export function verifyFileMagic(
  extension: string,
  bytes: Uint8Array,
): { ok: true; kind: SniffedKind } | { ok: false; reason: string } {
  const ext = extension.toLowerCase().replace(/^\./, "");
  const expected = EXTENSION_KIND[ext];
  if (!expected) return { ok: false, reason: "EXTENSION_NOT_ALLOWED" };
  if (bytes.length === 0) return { ok: false, reason: "EMPTY_FILE" };
  const actual = sniffBytes(bytes);
  if (actual !== expected) {
    return { ok: false, reason: `MAGIC_MISMATCH:expected-${expected}:got-${actual}` };
  }
  return { ok: true, kind: actual };
}

/** How many leading bytes a magic check needs (MOBI's marker sits at 60). */
export const SNIFF_BYTES = 128;
