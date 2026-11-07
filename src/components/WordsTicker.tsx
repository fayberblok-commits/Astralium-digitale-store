/**
 * The moving-words band — a signature element of the owner's approved
 * design, carried into the wide big page: seven golden Arabic words
 * (wealth ◆ AI ◆ high-income projects ◆ programming ◆ online stores ◆
 * luxury design ◆ income every month) scrolling for real between the
 * hero and the books. Content is duplicated once for a seamless -50%
 * loop (the .words-track is direction:ltr internally, like Marquee,
 * so the loop math is identical in RTL locales). The diamonds cycle
 * the LED palette: green, red, gold, orange. Decorative — the words
 * restate themes the page copy already carries.
 */
const WORDS = [
  "ثروة",
  "ذكاء اصطناعي",
  "مشاريع الدخل العالي",
  "برمجة",
  "متاجر إلكترونية",
  "تصميم فاخر",
  "دخل كل شهر",
];

export default function WordsTicker() {
  const doubled = [...WORDS, ...WORDS];
  return (
    <div className="words-band cycle-line" aria-hidden="true">
      <div className="words-track">
        {doubled.map((word, i) => (
          <span className="words-item" key={i}>
            {word}
            <span className={`words-dia words-dia-${i % 4}`}>◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}
