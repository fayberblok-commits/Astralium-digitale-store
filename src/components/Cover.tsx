/**
 * Cover art. The five real books ship their printed cover artwork as
 * data-URI assets (assets/covers.ts): when a product id matches, the
 * REAL cover renders inside a thin LED frame (.led-cover, cycling
 * with the owner's colour track). Every other product keeps the
 * original CSS-generated art — zero external images, deterministic
 * deep duotones (forest, burgundy, navy, charcoal, bronze, petrol,
 * oxblood, espresso) with a gilt inner frame and serif title.
 */
import { coverImageFor } from "../assets/covers";

const MOTIFS: Record<string, string> = {
  ebooks: "✦",
  audiobooks: "♪",
  courses: "◆",
  templates: "▦",
  design: "◈",
  software: "⌘",
  music: "♫",
};

/** [lit, mid, deep] — deep classic duotones, no bright colour. */
const PALETTES: [string, string, string][] = [
  ["#1e3a2f", "#122720", "#081510"], // deep forest green
  ["#4a1520", "#2c0e15", "#180710"], // burgundy
  ["#1c2a44", "#111b30", "#080f1d"], // classic navy
  ["#2b2620", "#1a1712", "#0e0c09"], // charcoal & brown-black
  ["#3a2410", "#251706", "#140b03"], // deep bronze
  ["#22333d", "#131f27", "#0a1116"], // dark petrol slate
  ["#38161c", "#220d11", "#120608"], // oxblood
  ["#2e2118", "#1d140d", "#0f0a06"], // espresso brown
];

export default function Cover({
  title,
  category,
  hue,
  size = "md",
  id,
}: {
  title: string;
  category: string;
  hue: number;
  size?: "sm" | "md" | "lg";
  /** Product id — when it names one of the five real books, the
   *  printed cover artwork renders instead of the CSS duotone. */
  id?: string;
}) {
  const image = id ? coverImageFor(id) : null;
  if (image) {
    return (
      <div className={`cover cover-img cover-${size} led-cover`} aria-hidden="true">
        {/* Plain <img> by design: the codebase self-hosts all imagery
            and does not use the next/image optimizer anywhere. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" width={720} height={1080} />
      </div>
    );
  }
  const motif = MOTIFS[category] ?? "✦";
  const [lit, mid, deep] = PALETTES[Math.abs(Math.round(hue)) % PALETTES.length];
  return (
    <div
      className={`cover cover-${size}`}
      style={{
        background: `linear-gradient(155deg, ${lit} 0%, ${mid} 56%, ${deep} 100%)`,
      }}
      aria-hidden="true"
    >
      <span className="cover-stars" />
      <span className="cover-motif">{motif}</span>
      <span className="cover-title">{title}</span>
    </div>
  );
}
