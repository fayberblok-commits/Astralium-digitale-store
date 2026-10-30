import { test } from "node:test";
import assert from "node:assert/strict";

delete process.env.DATABASE_URL;

const receipt = await import("../src/lib/receipt.ts");
const { getFlag } = await import("../src/lib/flags.ts");

const DATA = receipt.receiptDataFor({
  orderId: "AST-TEST-42",
  email: "buyer@example.com",
  items: [
    { title: "The AI Profit Blueprint", priceUSD: 19 },
    { title: "The Silent Ocean — Audiobook (Deluxe)", priceUSD: 24 },
  ],
  totalUSD: 38.7,
  discountUSD: 4.3,
});

test("receipt data: subtotal from items, total honors the paid amount", () => {
  assert.equal(DATA.subtotalUSD, 43);
  assert.equal(DATA.discountUSD, 4.3);
  assert.equal(DATA.totalUSD, 38.7);
  assert.ok(DATA.taxesNote.includes("VAT"));
});

test("pdf structure: header, EOF, and byte-accurate xref offsets", () => {
  const pdf = receipt.buildReceiptPdf(DATA);
  const text = Buffer.from(pdf).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  // Every xref offset must point exactly at its "N 0 obj" header.
  const xrefIdx = text.indexOf("xref\n");
  assert.ok(xrefIdx > 0);
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(startxref, xrefIdx);
  const lines = text.slice(xrefIdx).split("\n");
  const count = Number(lines[1].split(" ")[1]);
  assert.equal(count, 6); // free entry + 5 objects
  for (let n = 1; n < count; n++) {
    const offset = Number(lines[2 + n].slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${n} 0 obj`), `object ${n} at offset ${offset}`);
  }
});

test("pdf content: order id, items, totals and taxes note are present", () => {
  const text = Buffer.from(receipt.buildReceiptPdf(DATA)).toString("latin1");
  assert.ok(text.includes("AST-TEST-42"));
  assert.ok(text.includes("The AI Profit Blueprint"));
  assert.ok(text.includes("$43.00"));
  assert.ok(text.includes("$38.70"));
  assert.ok(text.includes("Total paid"));
});

test("pdf escaping: parens/backslash escaped, em dash transliterated", () => {
  assert.equal(receipt.pdfEscapeText("Ocean — Audiobook (Deluxe)"), "Ocean - Audiobook \\(Deluxe\\)");
  assert.equal(receipt.pdfEscapeText("back\\slash"), "back\\\\slash");
  const text = Buffer.from(receipt.buildReceiptPdf(DATA)).toString("latin1");
  assert.ok(text.includes("The Silent Ocean - Audiobook \\(Deluxe\\)"));
  // The declared stream length must equal the real stream byte length.
  const m = text.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.ok(m);
  assert.equal(Number(m[1]), Buffer.from(m[2], "latin1").length);
});

test("receipts flag defaults ON (post-payment document, like other read-only features)", async () => {
  assert.equal(await getFlag("receipts"), true);
});
