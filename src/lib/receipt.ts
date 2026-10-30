/**
 * PDF receipts (Phase 4, feature 16). Flag `receipts` — default ON.
 *
 * A minimal, dependency-free PDF 1.4 writer: five objects (catalog,
 * pages, page, Helvetica font, content stream) with a byte-accurate
 * xref table. Text is WinAnsi-encoded; characters outside WinAnsi are
 * transliterated (—, – → -; curly quotes → straight) or replaced with
 * "?" — a receipt never fails to generate over a glyph.
 *
 * The receipt is attached to the delivery email (Resend attachments)
 * and downloadable from /api/receipt/[orderId] after the same payment
 * verification the success page uses (Stripe session) or from the
 * library's device-order flow.
 */

export interface ReceiptItem {
  title: string;
  priceUSD: number;
}

export interface ReceiptData {
  orderId: string;
  dateISO: string;
  email?: string | null;
  items: ReceiptItem[];
  subtotalUSD: number;
  discountUSD: number;
  totalUSD: number;
  /** Shown verbatim under the totals (taxes note). */
  taxesNote: string;
  brand?: string;
}

export const DEFAULT_TAXES_NOTE =
  "Digital goods: prices are in USD. VAT/GST/sales tax may apply based on your country of residence and is included in the total above where required by law.";

const TRANSLITERATE: Record<string, string> = {
  "—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
  "…": "...", "·": "-", "★": "*", "✓": "v", "→": "->",
};

/** Escape a string for a PDF literal string, WinAnsi-safe. */
export function pdfEscapeText(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const mapped = TRANSLITERATE[ch] ?? ch;
    for (const c of mapped) {
      const code = c.codePointAt(0) ?? 0;
      if (c === "\\") out += "\\\\";
      else if (c === "(") out += "\\(";
      else if (c === ")") out += "\\)";
      else if (code >= 32 && code <= 126) out += c;
      else if (code >= 160 && code <= 255) out += c; // Latin-1 range of WinAnsi
      else out += "?";
    }
  }
  return out;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function receiptLines(data: ReceiptData): { text: string; size: number; gap: number }[] {
  const lines: { text: string; size: number; gap: number }[] = [];
  lines.push({ text: data.brand ?? "Astralium Digitale Store", size: 20, gap: 30 });
  lines.push({ text: "Receipt", size: 14, gap: 22 });
  lines.push({ text: `Order: ${data.orderId}`, size: 11, gap: 16 });
  lines.push({ text: `Date: ${data.dateISO.slice(0, 10)}`, size: 11, gap: 16 });
  if (data.email) lines.push({ text: `Billed to: ${data.email}`, size: 11, gap: 22 });
  lines.push({ text: "Items", size: 12, gap: 18 });
  for (const item of data.items) {
    lines.push({ text: `${item.title}    ${money(item.priceUSD)}`, size: 11, gap: 15 });
  }
  lines.push({ text: `Subtotal: ${money(data.subtotalUSD)}`, size: 11, gap: 22 });
  if (data.discountUSD > 0) {
    lines.push({ text: `Discount: -${money(data.discountUSD)}`, size: 11, gap: 15 });
  }
  lines.push({ text: `Total paid: ${money(data.totalUSD)}`, size: 13, gap: 20 });
  lines.push({ text: data.taxesNote, size: 8, gap: 12 });
  lines.push({ text: "Thank you for shopping with Astralium. Download links are delivered by email and re-issued free from your account page.", size: 8, gap: 12 });
  return lines;
}

/** Build the receipt PDF. Byte-accurate xref; opens in any PDF reader. */
export function buildReceiptPdf(data: ReceiptData): Uint8Array {
  const lines = receiptLines(data);
  const contentParts: string[] = ["BT", "/F1 11 Tf", "50 780 Td"];
  let first = true;
  for (const line of lines) {
    if (!first) contentParts.push(`0 -${line.gap} Td`);
    first = false;
    contentParts.push(`/F1 ${line.size} Tf`, `(${pdfEscapeText(line.text)}) Tj`);
  }
  contentParts.push("ET");
  const content = contentParts.join("\n");

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  // Every emitted character is <= U+00FF (pdfEscapeText guarantees it),
  // so the document is assembled as Latin-1 bytes: string length ==
  // byte length, which keeps offsets and /Length byte-accurate.
  const bytes = (s: string) => Buffer.from(s, "latin1");
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(bytes(pdf).length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = bytes(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return bytes(pdf);
}

export function receiptPdfBase64(data: ReceiptData): string {
  return Buffer.from(buildReceiptPdf(data)).toString("base64");
}

/** ReceiptData for a verified order (shared by email attach + download). */
export function receiptDataFor(input: {
  orderId: string;
  email?: string | null;
  items: ReceiptItem[];
  totalUSD?: number;
  discountUSD?: number;
  dateISO?: string;
}): ReceiptData {
  const subtotalUSD = Math.round(input.items.reduce((s, i) => s + i.priceUSD, 0) * 100) / 100;
  const discountUSD = input.discountUSD ?? 0;
  return {
    orderId: input.orderId,
    dateISO: input.dateISO ?? new Date().toISOString(),
    email: input.email ?? null,
    items: input.items,
    subtotalUSD,
    discountUSD,
    totalUSD: input.totalUSD ?? Math.max(0, Math.round((subtotalUSD - discountUSD) * 100) / 100),
    taxesNote: DEFAULT_TAXES_NOTE,
  };
}
