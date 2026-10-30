import { ImageResponse } from "next/og";
import { getDictionary } from "../../i18n/dictionaries";
import { isLocale } from "../../i18n/locales";

/**
 * Default Open Graph image (Phase 5, SEO engine) — luxury-classic brand
 * card: warm ivory, ink black, antique gold double rule. Rendered by
 * next/og at build/request time; no external assets.
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
          padding: 64,
        }}
      >
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
