import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p5-wm-")));
delete process.env.DATABASE_URL;
process.env.S3_BUCKET = "test-bucket";
process.env.S3_ACCESS_KEY_ID = "AKIATEST";
process.env.S3_SECRET_ACCESS_KEY = "test-secret";

const { PDFDocument, PDFName, decodePDFRawStream } = await import("pdf-lib");
const wm = await import("../src/lib/watermark.ts");
const storage = await import("../src/services/storage.ts");

const BUYER = "buyer@example.com";
const ORDER = "AST-TEST-WM-1";
const LINE = wm.watermarkLine(BUYER, ORDER);

async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Original content page ${i + 1}`, { x: 50, y: 780, size: 14 });
  }
  return doc.save();
}

/** Decode a page's content stream into searchable text: pdf-lib writes
 * drawn strings as hex, so hex strings are converted back to latin1. */
function pageTexts(bytes) {
  return PDFDocument.load(bytes).then((doc) => {
    const ctx = doc.context;
    return doc.getPages().map((page) => {
      const contents = ctx.lookup(page.node.get(PDFName.of("Contents")));
      const rawStreams = contents?.asArray
        ? contents.asArray().map((s) => ctx.lookup(s))
        : [contents];
      const raw = rawStreams
        .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
        .join("\n");
      return raw.replace(/<([0-9A-Fa-f\s]+)>/g, (_m, hex) =>
        Buffer.from(hex.replace(/\s/g, ""), "hex").toString("latin1"),
      );
    });
  });
}

test("watermarkLine carries buyer email + order id; never invents an email", () => {
  assert.equal(wm.watermarkLine(BUYER, ORDER), `Licensed to ${BUYER} - Order ${ORDER} - Astralium Digitale Store`);
  const anon = wm.watermarkLine(null, ORDER);
  assert.ok(anon.includes(ORDER));
  assert.ok(!anon.includes("@"));
});

test("isPdfBytes detects the magic, rejects other files", async () => {
  const pdf = await makePdf(1);
  assert.equal(wm.isPdfBytes(pdf), true);
  assert.equal(wm.isPdfBytes(new TextEncoder().encode("PK\x03\x04 zip data")), false);
  assert.equal(wm.isPdfBytes(new Uint8Array(0)), false);
});

test("multi-page PDF: watermark text present on EVERY page; input bytes untouched", async () => {
  const original = await makePdf(3);
  const hashBefore = createHash("sha256").update(original).digest("hex");
  const result = await wm.stampPdfWatermark(original, LINE);
  assert.equal(result.ok, true);
  assert.equal(result.pages, 3);
  const texts = await pageTexts(result.bytes);
  assert.equal(texts.length, 3);
  for (const [i, text] of texts.entries()) {
    assert.ok(text.includes("Licensed to"), `page ${i + 1} must carry the watermark`);
    assert.ok(text.includes(ORDER), `page ${i + 1} must carry the order id`);
    assert.ok(text.includes(`Original content page ${i + 1}`), "original content preserved");
  }
  // The source buffer (what storage holds) is byte-identical afterwards.
  assert.equal(createHash("sha256").update(original).digest("hex"), hashBefore);
  assert.notEqual(Buffer.from(result.bytes).toString("latin1"), Buffer.from(original).toString("latin1"));
});

test("non-PDF and corrupt inputs are classified, never thrown", async () => {
  assert.deepEqual(await wm.stampPdfWatermark(new TextEncoder().encode("just text"), LINE), { ok: false, reason: "not-pdf" });
  const corrupt = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");
  const res = await wm.stampPdfWatermark(corrupt, LINE);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "corrupt");
});

test("encrypted PDFs classify as 'encrypted' (footer falls back to original)", async () => {
  // Minimal PDF whose trailer declares an Encrypt dictionary: pdf-lib
  // refuses to load it (EncryptedPDFError) without the password.
  const body = [
    "%PDF-1.4",
    "1 0 obj", "<< /Type /Catalog /Pages 2 0 R >>", "endobj",
    "2 0 obj", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "endobj",
    "3 0 obj", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>", "endobj",
    "trailer", "<< /Size 4 /Root 1 0 R /Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -44 >> >>",
    "%%EOF",
  ].join("\n");
  const res = await wm.stampPdfWatermark(new TextEncoder().encode(body), LINE);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "encrypted");
});

test("fetchStampedPdf: stamped copy out, storage original never modified; non-PDF untouched path", async () => {
  const original = await makePdf(2);
  const storedCopy = Buffer.from(original); // what the bucket "holds"
  const mockFetch = async () =>
    new Response(storedCopy, { status: 200, headers: { "content-type": "application/pdf" } });
  const out = await wm.fetchStampedPdf("products/p01/book.pdf", LINE, mockFetch);
  assert.ok(out);
  assert.equal(out.stamped, true);
  const texts = await pageTexts(out.bytes);
  assert.ok(texts.every((t) => t.includes("Licensed to")));
  // The stored object is byte-identical: stamping only ever copies.
  assert.equal(createHash("sha256").update(storedCopy).digest("hex"), createHash("sha256").update(original).digest("hex"));
  // Non-PDF keys are not fetched at all (redirect path preserved).
  const none = await wm.fetchStampedPdf("products/p01/audio.mp3", LINE, async () => {
    throw new Error("must not fetch");
  });
  assert.equal(none, null);
});

test("getObjectBytes: signed GET returns bytes; 404 and oversize return null", async () => {
  const payload = new TextEncoder().encode("hello object");
  const okFetch = async () => new Response(payload, { status: 200 });
  const bytes = await storage.getObjectBytes("products/p01/x.pdf", 1024, okFetch);
  assert.deepEqual(Buffer.from(bytes).toString(), "hello object");
  const notFound = async () => new Response("nope", { status: 404 });
  assert.equal(await storage.getObjectBytes("products/p01/x.pdf", 1024, notFound), null);
  const tooBig = async () => new Response(payload, { status: 200, headers: { "content-length": "999999" } });
  assert.equal(await storage.getObjectBytes("products/p01/x.pdf", 10, tooBig), null);
});
