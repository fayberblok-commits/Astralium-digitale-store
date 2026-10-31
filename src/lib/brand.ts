/**
 * Astralium brand identity (Phase 2 upgrade) — single source of truth.
 *
 * The mark: a four-point "astral" star (an astroid sparkle) cradled by
 * a fine ring and crossed by a tilted orbit with one small planet —
 * original geometry, drawn from a parametric curve; it references no
 * other brand's registered marks. This module generates the SVG
 * artwork consumed by the header Logo component, the admin brand
 * guide and scripts/generate-brand.mjs (which writes brand/ + the
 * public copies + social PNGs).
 *
 * ⚠ TRADEMARK: adopting this logo for trade requires a trademark
 * clearance search in the owner's markets first — see brand/BRAND.md.
 */

/** Parametric astroid sparkle path centred on (cx, cy) with radius r. */
export function starPath(cx: number, cy: number, r: number, points = 72): string {
  const p = 0.6; // |x|^p + |y|^p = r^p — cusps on the axes, concave sides
  const pts: string[] = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const rho = r / Math.pow(Math.pow(Math.abs(c), p) + Math.pow(Math.abs(s), p), 1 / p);
    pts.push(`${(cx + rho * c).toFixed(2)},${(cy + rho * s).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

export interface LogoColors {
  star: string;
  ring: string;
  orbit: string;
  planet: string;
  word: string;
  suffix: string;
}

/** The maison colourway of the mark (works on light or dark ground). */
export const LOGO_COLORS: LogoColors = {
  star: "#b08d3c",
  ring: "#b08d3c",
  orbit: "#8a6d1f",
  planet: "#b08d3c",
  word: "currentColor",
  suffix: "#8a6d1f",
};

export const LOGO_MONO: LogoColors = {
  star: "currentColor", ring: "currentColor", orbit: "currentColor",
  planet: "currentColor", word: "currentColor", suffix: "currentColor",
};

/** For dark grounds: champagne star, ivory wordmark. */
export const LOGO_ON_DARK: LogoColors = {
  star: "#d6be8c", ring: "#d6be8c", orbit: "#b08d3c",
  planet: "#d6be8c", word: "#f6f1e7", suffix: "#d6be8c",
};

/** For light grounds: deep antique gold, ink wordmark. */
export const LOGO_ON_LIGHT: LogoColors = {
  star: "#a8842c", ring: "#a8842c", orbit: "#85661d",
  planet: "#a8842c", word: "#171512", suffix: "#7d5f1a",
};

/** The symbol alone (64×64 viewBox): ring + orbit + star + planet. */
export function logoSymbolSvg(colors: LogoColors, title = "Astralium"): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${title}">` +
    `<circle cx="32" cy="32" r="25.5" fill="none" stroke="${colors.ring}" stroke-width="1.6"/>` +
    `<ellipse cx="32" cy="32" rx="29" ry="10.5" fill="none" stroke="${colors.orbit}" stroke-width="1.1" transform="rotate(-18 32 32)"/>` +
    `<circle cx="56.9" cy="23.4" r="2.3" fill="${colors.planet}"/>` +
    `<path d="${starPath(32, 32, 14.5)}" fill="${colors.star}"/>` +
    `<circle cx="32" cy="32" r="2" fill="${colors.planet}"/>` +
    `</svg>`
  );
}

/** Symbol + wordmark, horizontal lockup (200×64 viewBox). */
export function logoHorizontalSvg(colors: LogoColors): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 208 64" role="img" aria-label="Astralium Digitale Store">` +
    `<circle cx="32" cy="32" r="25.5" fill="none" stroke="${colors.ring}" stroke-width="1.6"/>` +
    `<ellipse cx="32" cy="32" rx="29" ry="10.5" fill="none" stroke="${colors.orbit}" stroke-width="1.1" transform="rotate(-18 32 32)"/>` +
    `<circle cx="56.9" cy="23.4" r="2.3" fill="${colors.planet}"/>` +
    `<path d="${starPath(32, 32, 14.5)}" fill="${colors.star}"/>` +
    `<circle cx="32" cy="32" r="2" fill="${colors.planet}"/>` +
    `<text x="70" y="34" font-family="'Playfair Display', 'Amiri', Georgia, serif" font-size="23" letter-spacing="1.5" fill="${colors.word}">ASTRALIUM</text>` +
    `<text x="71" y="50" font-family="'Inter', 'IBM Plex Sans Arabic', Arial, sans-serif" font-size="8.5" letter-spacing="4.2" fill="${colors.suffix}">DIGITALE STORE</text>` +
    `</svg>`
  );
}

/** Symbol over wordmark, stacked lockup (160×120 viewBox). */
export function logoStackedSvg(colors: LogoColors): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 118" role="img" aria-label="Astralium Digitale Store">` +
    `<g transform="translate(48 0)">` +
    `<circle cx="32" cy="32" r="25.5" fill="none" stroke="${colors.ring}" stroke-width="1.6"/>` +
    `<ellipse cx="32" cy="32" rx="29" ry="10.5" fill="none" stroke="${colors.orbit}" stroke-width="1.1" transform="rotate(-18 32 32)"/>` +
    `<circle cx="56.9" cy="23.4" r="2.3" fill="${colors.planet}"/>` +
    `<path d="${starPath(32, 32, 14.5)}" fill="${colors.star}"/>` +
    `<circle cx="32" cy="32" r="2" fill="${colors.planet}"/>` +
    `</g>` +
    `<text x="80" y="90" text-anchor="middle" font-family="'Playfair Display', 'Amiri', Georgia, serif" font-size="21" letter-spacing="2" fill="${colors.word}">ASTRALIUM</text>` +
    `<text x="80" y="108" text-anchor="middle" font-family="'Inter', 'IBM Plex Sans Arabic', Arial, sans-serif" font-size="8" letter-spacing="4" fill="${colors.suffix}">DIGITALE STORE</text>` +
    `</svg>`
  );
}

/** Official tagline per language (brand voice — brand/BRAND.md). */
export const TAGLINES: Record<string, string> = {
  en: "Digital products, delivered among the stars.",
  ar: "منتجات رقمية تصلُك بين النجوم.",
  fr: "Des produits numériques, livrés parmi les étoiles.",
  es: "Productos digitales, entregados entre las estrellas.",
  de: "Digitale Produkte, geliefert zwischen den Sternen.",
};

/** Brand voice pillars (short form for the admin guide). */
export const BRAND_VOICE: Record<string, { tone: string; do: string; dont: string }> = {
  en: {
    tone: "Warm, precise, quietly luxurious — a maison concierge, never a hype merchant.",
    do: "Speak of craft, instant delivery and guarantees in plain words; let the products shine.",
    dont: "No shouting, no fake scarcity, no slang, no purple prose.",
  },
  ar: {
    tone: "دافئة ودقيقة وفاخرة بهدوء — كخادم ضيافة راقٍ، لا كبائع صاخب.",
    do: "تحدّث عن الحِرفية والتسليم الفوري والضمان بكلمات واضحة، ودَع المنتجات تتألق.",
    dont: "لا صراخ، لا ندرة مصطنعة، لا عامية مبتذلة، لا مبالغة.",
  },
};
