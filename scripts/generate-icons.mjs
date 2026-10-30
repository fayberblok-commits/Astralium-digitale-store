#!/usr/bin/env node
/**
 * Generate the PWA brand icons (Phase 6, feature 28).
 *
 * No image dependencies: a minimal PNG encoder (zlib + CRC32 from the
 * Node standard library) rasterises the luxury-classic mark — an
 * antique-gold four-point star inside a thin gold ring on ink — per
 * pixel. Run once; the PNGs are committed under public/icons/.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

// ─── Minimal PNG encoder ─────────────────────────────────────────────────────
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, pixelAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y, size);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── The mark: gold ✦ star + ring on ink (maskable-safe padding) ─────────────
const INK = [20, 16, 12]; // #14100C
const IVORY = [246, 241, 231]; // #F6F1E7
const GOLD = [176, 141, 87]; // antique gold #B08D57
const GOLD_DEEP = [138, 109, 66];

function starTest(nx, ny, r) {
  // ✦ four-point star = an astroid: |x|^p + |y|^p < r^p with p = 0.6
  // gives cusps on the axes and concave sides — the sparkle silhouette.
  const p = 0.6;
  return Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(ny), p) < Math.pow(r, p);
}

function makePixel(maskable) {
  return (x, y, size) => {
    const nx = (x / size) * 2 - 1;
    const ny = (y / size) * 2 - 1;
    const dist = Math.hypot(nx, ny);
    // background: ink with a whisper of radial warmth
    let [r, g, b] = INK;
    const warm = Math.max(0, 1 - dist) * 10;
    r += warm; g += warm * 0.8; b += warm * 0.4;
    // thin double ring
    const ringR = maskable ? 0.86 : 0.9;
    if (Math.abs(dist - ringR) < 0.012 || Math.abs(dist - (ringR - 0.045)) < 0.008) {
      [r, g, b] = GOLD_DEEP;
    }
    // star
    const starR = maskable ? 0.56 : 0.64;
    if (starTest(nx, ny, starR)) {
      const shade = 1 - 0.25 * Math.max(0, ny); // gentle top light
      [r, g, b] = GOLD.map((v) => Math.round(v * shade));
    }
    // centre jewel: ivory dot
    if (dist < 0.055) [r, g, b] = IVORY;
    return [r, g, b, 255];
  };
}

mkdirSync(OUT, { recursive: true });
const jobs = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
];
for (const [name, size, maskable] of jobs) {
  const png = encodePng(size, makePixel(maskable));
  writeFileSync(path.join(OUT, name), png);
  console.log(`${name}: ${size}x${size}, ${png.length} bytes`);
}
