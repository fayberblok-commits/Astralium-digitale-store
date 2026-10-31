/**
 * Marquee strip (Phase 2 upgrade): trust badges and review signals
 * scrolling gently under the hero. Content is duplicated once for a
 * seamless -50% loop; the track is direction:ltr internally so the
 * loop math is identical in RTL locales. Reduced-motion (or the
 * owner's motion toggle) renders it as a static centred row instead.
 */
export default function Marquee({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {doubled.map((item, i) => (
          <span className="marquee-item" key={i}>
            <span className="marquee-star">✦</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
