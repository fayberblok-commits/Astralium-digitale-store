/**
 * Phase 2 upgrade — themes, brand identity & motion contracts:
 * palette registry completeness, WCAG AA contrast for every
 * palette × mode, settings sanitizing, logo geometry, and the
 * maison-classic preservation guarantee.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const themes = await import("../src/lib/themes.ts");
const settings = await import("../src/lib/theme-settings.ts");
const brand = await import("../src/lib/brand.ts");

const { PALETTES, getPalette, paletteCss, contrastRatio, contrastReport, palettePassesAa } = themes;

test("contrast math: black on white is 21:1, identical colours are 1:1", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#123456", "#123456") - 1) < 0.001);
});

test("registry: six palettes, maison-classic first and preserved as the default", () => {
  assert.equal(PALETTES.length, 6);
  assert.deepEqual(
    PALETTES.map((p) => p.id),
    ["maison-classic", "aurora-dawn", "tropical-glow", "cosmic-candy", "emerald-gold", "electric-blue"],
  );
  assert.equal(themes.DEFAULT_PALETTE_ID, "maison-classic");
  assert.equal(getPalette("nope").id, "maison-classic");
  assert.equal(getPalette(undefined).id, "maison-classic");
});

test("maison-classic preserves the pre-upgrade identity tokens exactly", () => {
  const classic = getPalette("maison-classic");
  assert.equal(classic.light.bg, "#f6f1e7"); // warm ivory
  assert.equal(classic.light.text, "#171512"); // ink
  assert.equal(classic.light.accent, "#a8842c"); // antique gold
  assert.equal(classic.dark.bg, "#100e0c");
  assert.equal(classic.dark.accentInk, "#d6be8c"); // champagne reads as text on dark
  assert.equal(classic.dark.btnText, "#e9d9ae");
});

test("every palette has a complete token set in both modes and 4 gradient stops", () => {
  const keys = ["bg", "bg2", "surface", "surfaceStrong", "text", "muted", "accent", "accentDeep", "accentInk", "champagne", "btnBg", "btnText", "ok", "err"];
  for (const p of PALETTES) {
    assert.equal(p.grad.length, 4, p.id);
    for (const mode of ["light", "dark"]) {
      for (const k of keys) {
        assert.match(p[mode][k], /^#[0-9a-f]{6}$/i, `${p.id}/${mode}/${k}`);
      }
    }
  }
});

test("WCAG AA: every text pair passes in every palette × mode (incl. gradient stops)", () => {
  for (const p of PALETTES) {
    assert.ok(palettePassesAa(p), p.id);
    for (const mode of ["light", "dark"]) {
      const failing = contrastReport(p, mode).filter((c) => !c.pass);
      assert.deepEqual(failing, [], `${p.id}/${mode}`);
    }
  }
});

test("paletteCss emits both mode blocks with the full token set", () => {
  const css = paletteCss(getPalette("aurora-dawn"));
  assert.ok(css.includes('html[data-palette="aurora-dawn"][data-theme="dark"]'));
  assert.ok(css.includes('html[data-palette="aurora-dawn"][data-theme="light"]'));
  for (const v of ["--bg:", "--text:", "--gold:", "--grad-1:", "--grad-4:", "--on-grad:", "--glow:", "color-scheme:dark", "color-scheme:light"]) {
    assert.ok(css.includes(v), v);
  }
});

test("theme settings sanitize: bad palette/mode fall back, motion defaults on", () => {
  assert.deepEqual(settings.sanitizeThemeSettings(null), settings.DEFAULT_THEME_SETTINGS);
  assert.deepEqual(settings.sanitizeThemeSettings({ palette: "evil", mode: "neon", motion: "yes" }), {
    palette: "maison-classic", mode: "system", motion: true,
  });
  assert.deepEqual(settings.sanitizeThemeSettings({ palette: "cosmic-candy", mode: "dark", motion: false }), {
    palette: "cosmic-candy", mode: "dark", motion: false,
  });
});

test("brand mark: star path is a closed astroid; SVGs are self-contained", () => {
  const d = brand.starPath(32, 32, 14.5);
  assert.ok(d.startsWith("M") && d.endsWith("Z"));
  assert.ok(d.split("L").length >= 70);
  const symbol = brand.logoSymbolSvg(brand.LOGO_ON_LIGHT);
  assert.ok(symbol.includes('viewBox="0 0 64 64"'));
  assert.ok(symbol.includes("<ellipse")); // the orbit
  assert.ok(!symbol.includes("http") || symbol.includes("www.w3.org")); // no external assets
  const mono = brand.logoHorizontalSvg(brand.LOGO_MONO);
  assert.ok(!/#[0-9a-f]{3,6}/i.test(mono.replace(/xmlns="[^"]*"/, "")), "mono variant must be pure currentColor");
});

test("taglines exist for en/ar/fr/es/de and the Arabic voice mirrors the English", () => {
  for (const lang of ["en", "ar", "fr", "es", "de"]) {
    assert.ok(brand.TAGLINES[lang]?.length > 10, lang);
  }
  assert.ok(brand.BRAND_VOICE.en && brand.BRAND_VOICE.ar);
});
