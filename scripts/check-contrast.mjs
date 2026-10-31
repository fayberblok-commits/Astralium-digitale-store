#!/usr/bin/env node
/**
 * WCAG AA contrast audit for every theme palette × mode
 * (Phase 2 upgrade). Prints the full table; exits 1 on any failure.
 *
 *   node scripts/check-contrast.mjs
 */
import { PALETTES, contrastReport } from "../src/lib/themes.ts";

let failures = 0;
for (const palette of PALETTES) {
  for (const mode of ["light", "dark"]) {
    const rows = contrastReport(palette, mode);
    console.log(`\n${palette.id} — ${mode}`);
    for (const r of rows) {
      const mark = r.pass ? "✓" : "✗ FAIL";
      if (!r.pass) failures++;
      console.log(`  ${mark}  ${r.pair.padEnd(28)} ${r.ratio.toFixed(2)}:1  (needs ${r.required}:1)`);
    }
  }
}
console.log(failures === 0 ? "\nALL PALETTES PASS WCAG AA" : `\n${failures} FAILING PAIRS`);
process.exit(failures === 0 ? 0 : 1);
