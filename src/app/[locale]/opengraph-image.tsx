import { ImageResponse } from "next/og";
import { getDictionary } from "../../i18n/dictionaries";
import { isLocale } from "../../i18n/locales";

/**
 * Default Open Graph image (Phase 5 SEO engine; identity refreshed
 * in the Phase 2 brand upgrade) — maison card: warm ivory, ink,
 * antique-gold double rule, the astral mark in its ring, and an
 * aurora accent bar from the Aurora Dawn palette. Rendered by
 * next/og at build/request time; no external assets. Template
 * notes live in brand/templates/og-template.md.
 */
export const alt = "Astralium Digitale Store";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const dict = getDictionary(isLocale(locale) ? locale : "en");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", background: "#F6F1E7", color: "#141210",
          padding: 64, position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute", top: 0, left: 0, right: 0, height: 10,
            background: "linear-gradient(90deg, #8E2A5C, #B23A48, #A85B1E, #1F6E6B)",
          }}
        />
        <div
          style={{
            position: "absolute", top: 64, right: 88, width: 132, height: 132, borderRadius: 66,
            border: "2px solid rgba(176, 141, 60, 0.45)", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 50, color: "#B08D3C",
          }}
        >
          ✦
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", border: "2px solid #B08D3C", padding: "56px 72px" }}>
          <div style={{ fontSize: 30, letterSpacing: 8, color: "#B08D3C", marginBottom: 18 }}>✦ ASTRALIUM ✦</div>
          <div style={{ fontSize: 58, fontFamily: "Georgia, serif", textAlign: "center", lineHeight: 1.15 }}>
            Digitale Store
          </div>
          <div style={{ width: 220, height: 2, background: "#B08D3C", margin: "28px 0 6px" }} />
          <div style={{ width: 220, height: 1, background: "#B08D3C", marginBottom: 22 }} />
          <div style={{ fontSize: 26, color: "#3A352C", textAlign: "center", maxWidth: 800 }}>{dict.tagline}</div>
        </div>
      </div>
    ),
    size,
  );
}
