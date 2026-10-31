import { starPath } from "../lib/brand";

/**
 * The Astralium mark as inline SVG (Phase 2 upgrade): astral star,
 * fine ring, tilted orbit, one planet. Colours follow the active
 * palette through currentColor/CSS vars — `tone="brand"` uses the
 * palette accent; mono variants inherit text colour.
 */
export default function Logo({
  size = 30,
  tone = "brand",
  className,
}: {
  size?: number;
  tone?: "brand" | "mono";
  className?: string;
}) {
  const star = tone === "brand" ? "var(--gold)" : "currentColor";
  const ring = tone === "brand" ? "var(--gold)" : "currentColor";
  const orbit = tone === "brand" ? "var(--gold-deep)" : "currentColor";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flex: "none", display: "block" }}
    >
      <circle cx="32" cy="32" r="25.5" fill="none" stroke={ring} strokeWidth="1.6" />
      <ellipse cx="32" cy="32" rx="29" ry="10.5" fill="none" stroke={orbit} strokeWidth="1.1" transform="rotate(-18 32 32)" />
      <circle cx="56.9" cy="23.4" r="2.3" fill={star} />
      <path d={starPath(32, 32, 14.5)} fill={star} />
      <circle cx="32" cy="32" r="2" fill={star} />
    </svg>
  );
}
