/**
 * PDF watermarking (Phase 5, feature 17). Flag `watermarking` — default ON.
 *
 * When a buyer's bound deliverable is a PDF, the download route serves a
 * COPY stamped on every page (footer, semi-transparent) with the buyer
 * email + order id. The object in storage is NEVER modified — stamping
 * happens in memory at download time (lib/pdf-lib does the PDF surgery;
 * it is the one dependency this feature justifies: correctly rewriting
 * arbitrary publisher PDFs — object streams, xref streams, encrypted
 * dictionaries — by hand would be the Phase-4 receipt writer's problem
 * squared, and a corrupt stamp would destroy paid deliverables).
 *
 * Failure honesty: encrypted or corrupt PDFs are served UNSTAMPED (the
 * original bytes) with a structured log note — a buyer who paid always
 * gets their file; the owner sees the gap in the logs. Non-PDF files
 * are never routed through here.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getObjectBytes } from "../services/storage.ts";

/** "%PDF-" magic, allowing the small leader some producers emit. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let i = 0; i + 5 <= head.length; i++) {
    if (
      head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 &&
      head[i + 3] === 0x46 && head[i + 4] === 0x2d
    ) return true;
  }
  return false;
}

/** One footer line. Email included when resolvable; never fabricated. */
export function watermarkLine(email: string | null | undefined, orderId: string): string {
  return email
    ? `Licensed to ${email} - Order ${orderId} - Astralium Digitale Store`
    : `Licensed copy - Order ${orderId} - Astralium Digitale Store`;
}

export function maxWatermarkBytes(): number {
  const mb = Number(process.env.WATERMARK_MAX_MB);
  const sane = Number.isFinite(mb) && mb > 0 && mb <= 500 ? mb : 50;
  return Math.floor(sane * 1024 * 1024);
}

export type StampResult =
  | { ok: true; bytes: Uint8Array; pages: number }
  | { ok: false; reason: "not-pdf" | "encrypted" | "corrupt" };

/**
 * Stamp `text` in the footer of every page (centred, 8pt, warm grey,
 * 55% opacity). Returns a NEW byte array — the input is never mutated.
 */
export async function stampPdfWatermark(bytes: Uint8Array, text: string): Promise<StampResult> {
  if (!isPdfBytes(bytes)) return { ok: false, reason: "not-pdf" };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: /encrypt/i.test(msg) ? "encrypted" : "corrupt" };
  }
  try {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const size = 8;
    const textWidth = font.widthOfTextAtSize(text, size);
    for (const page of doc.getPages()) {
      const { width } = page.getSize();
      page.drawText(text, {
        x: Math.max(18, (width - textWidth) / 2),
        y: 16,
        size,
        font,
        color: rgb(0.36, 0.33, 0.29),
        opacity: 0.55,
      });
    }
    const out = await doc.save();
    return { ok: true, bytes: out, pages: doc.getPageCount() };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

export interface FetchedDeliverable {
  bytes: Uint8Array;
  stamped: boolean;
  /** Why the copy is unstamped ("encrypted" | "corrupt") — for the log. */
  note?: string;
}

/**
 * Download-route helper: pull the bound object through the app and stamp
 * it when it is a PDF. Returns null when the object cannot be fetched
 * (caller then falls back to the presigned redirect, exactly as before).
 * Non-PDF objects are NOT fetched here (returns null) so audio/video
 * keep the redirect path.
 */
export async function fetchStampedPdf(
  fileKey: string,
  line: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedDeliverable | null> {
  if (!/\.pdf($|\?)/i.test(fileKey)) return null;
  const bytes = await getObjectBytes(fileKey, maxWatermarkBytes(), fetchImpl);
  if (!bytes || !isPdfBytes(bytes)) return null;
  const stamped = await stampPdfWatermark(bytes, line);
  if (stamped.ok) return { bytes: stamped.bytes, stamped: true };
  console.log(JSON.stringify({ event: "watermark.skipped", reason: stamped.reason, fileKey }));
  return { bytes, stamped: false, note: stamped.reason };
}
