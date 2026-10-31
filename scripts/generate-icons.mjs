#!/usr/bin/env node
/**
 * Generate the PWA brand icons (Phase 6, feature 28; mark refreshed
 * in the Phase 2 brand upgrade).
 *
 * No image dependencies: the shared minimal PNG encoder rasterises
 * the Astralium mark — an antique-gold four-point star inside a fine
 * ring, crossed by a tilted orbit with one small planet, on ink —
 * per pixel. Run once (and automatically as `prebuild`); the PNGs
 * are committed under public/icons/.
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, starTest } from "./lib/png.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const INK = [20, 16, 12]; // #14100C
const IVORY = [246, 241, 231]; // #F6F1E7
const GOLD = [176, 141, 87]; // antique gold #B08D57
const GOLD_DEEP = [138, 109, 66];

const ORBIT_TILT = (-18 * Math.PI) / 180;
const PLANET = { x: 0.83, y: -0.28, r: 0.075 }; // on the orbit, upper right

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
    // tilted orbit ellipse
    const ox = nx * Math.cos(ORBIT_TILT) - ny * Math.sin(ORBIT_TILT);
    const oy = nx * Math.sin(ORBIT_TILT) + ny * Math.cos(ORBIT_TILT);
    const orbitR = Math.hypot(ox / 0.97, oy / 0.35);
    if (Math.abs(orbitR - 1) < 0.022) [r, g, b] = GOLD_DEEP;
    // the planet riding the orbit
    if (Math.hypot(nx - PLANET.x, ny - PLANET.y) < PLANET.r) [r, g, b] = GOLD;
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
  const pixelAt = makePixel(maskable);
  const png = encodePng(size, size, (x, y) => pixelAt(x, y, size));
  writeFileSync(path.join(OUT, name), png);
  console.log(`${name}: ${size}x${size}, ${png.length} bytes`);
}
