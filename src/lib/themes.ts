/**
 * Storefront theme palettes (Phase 2 upgrade — brand & themes).
 *
 * SINGLE SOURCE OF TRUTH for the storefront's colour system. Each
 * palette ships a complete token set for light AND dark mode; the
 * layout server-renders the active palette's tokens as CSS variables
 * (`paletteCss`), so the owner can switch the whole store's identity
 * from the admin panel with no rebuild. `globals.css` keeps the
 * maison-classic values as the no-settings baseline — identical to
 * the "maison-classic" palette below.
 *
 * Contrast contract (WCAG AA, verified by tests/phase8-themes.test.mjs
 * and scripts/check-contrast.mjs): text pairs (text, muted, accentInk
 * on bg/surface/surfaceStrong; btnText on btnBg; onGrad on EVERY
 * gradient stop) must reach 4.5:1; the decorative accent must reach
 * 3:1 against bg (focus outlines, stars, large ornaments).
 */

export interface PaletteMode {
  bg: string;
  bg2: string;
  surface: string;
  surfaceStrong: string;
  text: string;
  muted: string;
  /** Brand accent — borders, stars, ornaments, focus ring. */
  accent: string;
  accentDeep: string;
  /** Accent that is safe as TEXT on bg (≥ 4.5:1). */
  accentInk: string;
  champagne: string;
  btnBg: string;
  btnText: string;
  ok: string;
  err: string;
}

export interface Palette {
  id: string;
  /** Animated-gradient stops for buy/checkout buttons (both modes —
   *  `onGrad` text must pass AA on every stop). */
  grad: [string, string, string, string];
  onGrad: string;
  /** Glow colour (rgba) under gradient buttons. */
  glow: string;
  light: PaletteMode;
  dark: PaletteMode;
}

const OK_ERR_LIGHT = { ok: "#1c7c38", err: "#b3261e" };
const OK_ERR_DARK = { ok: "#4ade80", err: "#f87171" };

export const PALETTES: Palette[] = [
  {
    // The owner's original identity — warm ivory, ink, antique gold.
    // Values identical to the pre-upgrade globals.css design tokens.
    id: "maison-classic",
    grad: ["#6e5514", "#85661d", "#7d5f1a", "#5e4710"],
    onGrad: "#ffffff",
    glow: "rgba(168, 132, 44, 0.45)",
    light: {
      bg: "#f6f1e7", bg2: "#efe7d4", surface: "#fbf8f0", surfaceStrong: "#fdfbf4",
      text: "#171512", muted: "#5e5748", accent: "#a8842c", accentDeep: "#85661d",
      accentInk: "#7d5f1a", champagne: "#d6be8c", btnBg: "#171512", btnText: "#f6f1e7",
      ...OK_ERR_LIGHT,
    },
    dark: {
      bg: "#100e0c", bg2: "#161310", surface: "#1b1813", surfaceStrong: "#1b1813",
      text: "#f1ead9", muted: "#ada28c", accent: "#a8842c", accentDeep: "#85661d",
      accentInk: "#d6be8c", champagne: "#d6be8c", btnBg: "#0a0908", btnText: "#e9d9ae",
      ...OK_ERR_DARK,
    },
  },
  {
    id: "aurora-dawn",
    grad: ["#8e2a5c", "#b23a48", "#a85b1e", "#1f6e6b"],
    onGrad: "#ffffff",
    glow: "rgba(214, 90, 130, 0.45)",
    light: {
      bg: "#fff8f0", bg2: "#fdeee3", surface: "#fffdf9", surfaceStrong: "#ffffff",
      text: "#33222e", muted: "#6e5a63", accent: "#d6336c", accentDeep: "#a61e4d",
      accentInk: "#b01e56", champagne: "#f4a259", btnBg: "#33222e", btnText: "#fff3e4",
      ...OK_ERR_LIGHT,
    },
    dark: {
      bg: "#171126", bg2: "#1e1733", surface: "#231a3d", surfaceStrong: "#2a2049",
      text: "#f6edf7", muted: "#c4b3d6", accent: "#f27ca7", accentDeep: "#c24d82",
      accentInk: "#f5a3c0", champagne: "#ffd9a0", btnBg: "#0e0a1a", btnText: "#fff6ec",
      ...OK_ERR_DARK,
    },
  },
  {
    id: "tropical-glow",
    grad: ["#0b6e5d", "#4c7a14", "#b4531f", "#a92444"],
    onGrad: "#ffffff",
    glow: "rgba(255, 176, 58, 0.45)",
    light: {
      bg: "#fdfbf2", bg2: "#f3efdb", surface: "#fffef8", surfaceStrong: "#ffffff",
      text: "#14342b", muted: "#4e6b5e", accent: "#0b7a6e", accentDeep: "#075e52",
      accentInk: "#0b6e5d", champagne: "#ffc24b", btnBg: "#14342b", btnText: "#fff7e0",
      ...OK_ERR_LIGHT,
    },
    dark: {
      bg: "#0c1f1b", bg2: "#11291f", surface: "#16302a", surfaceStrong: "#1a382f",
      text: "#effaf2", muted: "#a8cbbb", accent: "#ffb03a", accentDeep: "#d98a16",
      accentInk: "#ffc65c", champagne: "#ffd98a", btnBg: "#06120f", btnText: "#ffe9b8",
      ...OK_ERR_DARK,
    },
  },
  {
    id: "cosmic-candy",
    grad: ["#86198f", "#6d28d9", "#1d4ed8", "#9d174d"],
    onGrad: "#ffffff",
    glow: "rgba(217, 70, 199, 0.45)",
    light: {
      bg: "#fef7ff", bg2: "#f9e8fd", surface: "#fffbff", surfaceStrong: "#ffffff",
      text: "#33183f", muted: "#6d5578", accent: "#c026d3", accentDeep: "#86198f",
      accentInk: "#a21caf", champagne: "#f0abfc", btnBg: "#33183f", btnText: "#fdf4ff",
      ...OK_ERR_LIGHT,
    },
    dark: {
      bg: "#150a24", bg2: "#1d1033", surface: "#241540", surfaceStrong: "#2c1a4e",
      text: "#f9f0ff", muted: "#c9b3e8", accent: "#f472b6", accentDeep: "#db2777",
      accentInk: "#f9a8d4", champagne: "#fde68a", btnBg: "#0b0518", btnText: "#ffe9f6",
      ...OK_ERR_DARK,
    },
  },
  {
    id: "emerald-gold",
    grad: ["#065f46", "#0b6e4f", "#8a6d1f", "#14532d"],
    onGrad: "#ffffff",
    glow: "rgba(212, 175, 90, 0.45)",
    light: {
      bg: "#f5f8f0", bg2: "#e8efdc", surface: "#fbfdf7", surfaceStrong: "#ffffff",
      text: "#12291f", muted: "#4c6355", accent: "#a37f2c", accentDeep: "#8a6d1f",
      accentInk: "#0b6e4f", champagne: "#d6be8c", btnBg: "#0e2a1e", btnText: "#f3e9cf",
      ...OK_ERR_LIGHT,
    },
    dark: {
      bg: "#0a1710", bg2: "#0f2016", surface: "#14281c", surfaceStrong: "#183023",
      text: "#edf7ee", muted: "#a9c6b2", accent: "#d4af5a", accentDeep: "#a8842c",
      accentInk: "#e3c878", champagne: "#ebd9a0", btnBg: "#05100b", btnText: "#f1e3b0",
      ...OK_ERR_DARK,
    },
  },
  {
    id: "electric-blue",
    grad: ["#1d4ed8", "#0369a1", "#1e40af", "#0e7490"],
    onGrad: "#ffffff",
    glow: "rgba(56, 189, 248, 0.45)",
    light: {
      bg: "#f2f7ff", bg2: "#e0ecfd", surface: "#f8fbff", surfaceStrong: "#ffffff",
      text: "#0e1e3a", muted: "#47597a", accent: "#2563eb", accentDeep: "#1e40af",
      accentInk: "#1d4ed8", champagne: "#7dd3fc", btnBg: "#0a1b33", btnText: "#e8f3ff",
      ...OK_ERR_LIGHT,
    },
    dark: {
      bg: "#070f1f", bg2: "#0b1730", surface: "#101f3d", surfaceStrong: "#14264a",
      text: "#edf4ff", muted: "#a9bedf", accent: "#38bdf8", accentDeep: "#0284c7",
      accentInk: "#7dd3fc", champagne: "#bae6fd", btnBg: "#040a18", btnText: "#dff2ff",
      ...OK_ERR_DARK,
    },
  },
];

export const PALETTE_IDS = PALETTES.map((p) => p.id);
export const DEFAULT_PALETTE_ID = "maison-classic";

export function getPalette(id: string | undefined | null): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function isPaletteId(id: unknown): id is string {
  return typeof id === "string" && PALETTE_IDS.includes(id);
}

// ─── WCAG contrast math (pure — shared by tests, scripts, admin API) ────

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function linearChannel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastCheck {
  pair: string;
  ratio: number;
  required: number;
  pass: boolean;
}

/** Every AA pair the storefront depends on, for one palette × mode. */
export function contrastReport(palette: Palette, mode: "light" | "dark"): ContrastCheck[] {
  const m = palette[mode];
  const pairs: Array<[string, string, string, number]> = [
    ["text on bg", m.text, m.bg, 4.5],
    ["text on surface", m.text, m.surface, 4.5],
    ["text on surface-strong", m.text, m.surfaceStrong, 4.5],
    ["muted on bg", m.muted, m.bg, 4.5],
    ["muted on surface-strong", m.muted, m.surfaceStrong, 4.5],
    ["accent-ink on bg", m.accentInk, m.bg, 4.5],
    ["accent-ink on surface-strong", m.accentInk, m.surfaceStrong, 4.5],
    ["button text on button bg", m.btnText, m.btnBg, 4.5],
    ["accent on bg (large/focus)", m.accent, m.bg, 3],
    ...palette.grad.map((stop, i) => [`gradient text on stop ${i + 1}`, palette.onGrad, stop, 4.5] as [string, string, string, number]),
  ];
  return pairs.map(([pair, fg, bg, required]) => {
    const ratio = contrastRatio(fg, bg);
    return { pair, ratio: Math.round(ratio * 100) / 100, required, pass: ratio >= required };
  });
}

export function palettePassesAa(palette: Palette): boolean {
  return (["light", "dark"] as const).every((mode) =>
    contrastReport(palette, mode).every((c) => c.pass),
  );
}

// ─── CSS emission ─────────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function modeVars(palette: Palette, m: PaletteMode, scheme: "light" | "dark"): string {
  return [
    `--bg:${m.bg}`,
    `--bg-2:${m.bg2}`,
    `--surface:${m.surface}`,
    `--surface-strong:${m.surfaceStrong}`,
    `--line:${hexToRgba(m.text, scheme === "dark" ? 0.18 : 0.16)}`,
    `--line-gold:${hexToRgba(m.accent, 0.5)}`,
    `--text:${m.text}`,
    `--muted:${m.muted}`,
    `--gold:${m.accent}`,
    `--gold-deep:${m.accentDeep}`,
    `--champagne:${m.champagne}`,
    `--gold-ink:${m.accentInk}`,
    `--header-bg:${hexToRgba(m.bg, 0.94)}`,
    `--btn-bg:${m.btnBg}`,
    `--btn-text:${m.btnText}`,
    `--btn2-border:${hexToRgba(m.text, 0.55)}`,
    `--ok:${m.ok}`,
    `--err:${m.err}`,
    `--accent:${m.accent}`,
    `--accent-deep:${m.accentDeep}`,
    `--accent-ink:${m.accentInk}`,
    `--grad-1:${palette.grad[0]}`,
    `--grad-2:${palette.grad[1]}`,
    `--grad-3:${palette.grad[2]}`,
    `--grad-4:${palette.grad[3]}`,
    `--on-grad:${palette.onGrad}`,
    `--glow:${palette.glow}`,
    `--shadow:${scheme === "dark" ? "0 14px 34px rgba(0, 0, 0, 0.45)" : "0 14px 34px rgba(23, 21, 18, 0.14)"}`,
    `color-scheme:${scheme}`,
  ].join(";");
}

/**
 * The `<style>` payload the layout injects for the active palette.
 * Selectors out-specify the globals.css `:root[data-theme=…]` baseline
 * (element + two attributes), so the owner's choice always wins —
 * in both modes, with zero rebuild.
 */
export function paletteCss(palette: Palette): string {
  const sel = `html[data-palette="${palette.id}"]`;
  return (
    `${sel}[data-theme="dark"]{${modeVars(palette, palette.dark, "dark")}}` +
    `${sel}[data-theme="light"]{${modeVars(palette, palette.light, "light")}}`
  );
}

/** Swatch colors for admin previews (light-mode primaries). */
export function paletteSwatches(palette: Palette): string[] {
  return [palette.light.bg, palette.light.accent, palette.grad[0], palette.grad[1], palette.grad[2], palette.grad[3]];
}
