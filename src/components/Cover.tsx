/**
 * CSS-generated cover art — zero external images, so the store is fast,
 * self-contained and never breaks on a missing asset. Each product gets a
 * deterministic gradient + motif from its hue and category.
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
  return (
    <div
      className={`cover cover-${size}`}
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 65% 24%) 0%, hsl(${(hue + 40) % 360} 70% 12%) 58%, hsl(${hue} 80% 7%) 100%)`,
      }}
      aria-hidden="true"
    >
      <span className="cover-stars" />
      <span className="cover-motif">{motif}</span>
      <span className="cover-title">{title}</span>
    </div>
  );
}
