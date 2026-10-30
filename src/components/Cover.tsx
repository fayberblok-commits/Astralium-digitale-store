/**
 * CSS-generated cover art — zero external images, so the store is fast,
 * self-contained and never breaks on a missing asset. Each product's hue
 * deterministically selects one of the maison's classic deep duotones
 * (forest, burgundy, navy, charcoal, bronze, petrol, oxblood, espresso),
 * finished with a gilt inner frame and serif title via .cover in CSS.
 */
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
}: {
  title: string;
  category: string;
  hue: number;
  size?: "sm" | "md" | "lg";
}) {
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
