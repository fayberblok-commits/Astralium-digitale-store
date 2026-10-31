import Logo from "./Logo";
import { BRAND_VOICE, TAGLINES, logoHorizontalSvg, LOGO_ON_DARK, LOGO_ON_LIGHT } from "../lib/brand";
import type { Palette } from "../lib/themes";

/**
 * Admin brand-guide (Phase 2 upgrade): the identity kit at a glance —
 * logo variants, taglines, voice, typography and the active palette's
 * colour tokens. Artwork sources live in brand/ (see BRAND.md there);
 * the SVG strings rendered here come from lib/brand.ts, the same
 * generator that writes the kit files.
 */
export interface BrandDict {
  logo: string;
  colors: string;
  type: string;
  typeD: string;
  voice: string;
  tagline: string;
  assets: string;
  assetsD: string;
  trademark: string;
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <span className="brand-swatch">
      <span className="brand-swatch-chip" style={{ background: hex }} />
      <span>{name}</span>
      <code>{hex}</code>
    </span>
  );
}

export default function BrandGuidePanel({
  dict,
  palette,
  locale,
}: {
  dict: BrandDict;
  palette: Palette;
  locale: string;
}) {
  const voice = BRAND_VOICE[locale] ?? BRAND_VOICE.en;
  return (
    <div>
      <h3>{dict.logo}</h3>
      <div className="brand-logo-row">
        <div className="brand-logo-chip brand-logo-light">
          <span dangerouslySetInnerHTML={{ __html: logoHorizontalSvg(LOGO_ON_LIGHT) }} />
        </div>
        <div className="brand-logo-chip brand-logo-dark">
          <span dangerouslySetInnerHTML={{ __html: logoHorizontalSvg(LOGO_ON_DARK) }} />
        </div>
        <div className="brand-logo-chip brand-logo-mono">
          <Logo size={44} tone="mono" />
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.2rem", letterSpacing: "0.08em" }}>ASTRALIUM</span>
        </div>
      </div>

      <h3>{dict.tagline}</h3>
      <table className="admin-table">
        <tbody>
          {Object.entries(TAGLINES).map(([lang, line]) => (
            <tr key={lang}>
              <td style={{ width: 60 }}><code>{lang}</code></td>
              <td>{line}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{dict.voice}</h3>
      <p style={{ marginBottom: 4 }}><strong>{voice.tone}</strong></p>
      <p className="muted" style={{ margin: "2px 0" }}>✓ {voice.do}</p>
      <p className="muted" style={{ margin: "2px 0" }}>✗ {voice.dont}</p>

      <h3>{dict.type}</h3>
      <p style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", margin: "4px 0" }}>
        Astralium — Playfair Display · أستراليوم — Amiri
      </p>
      <p style={{ margin: "4px 0" }}>
        Inter for Latin body text · IBM Plex Sans Arabic للنصوص العربية
      </p>
      <p className="muted">{dict.typeD}</p>

      <h3>{dict.colors} — {palette.id}</h3>
      <div className="brand-swatches">
        <Swatch name="accent (light)" hex={palette.light.accent} />
        <Swatch name="accent-ink (light)" hex={palette.light.accentInk} />
        <Swatch name="bg (light)" hex={palette.light.bg} />
        <Swatch name="text (light)" hex={palette.light.text} />
        <Swatch name="accent (dark)" hex={palette.dark.accent} />
        <Swatch name="accent-ink (dark)" hex={palette.dark.accentInk} />
        <Swatch name="bg (dark)" hex={palette.dark.bg} />
        <Swatch name="text (dark)" hex={palette.dark.text} />
        {palette.grad.map((g, i) => (
          <Swatch key={i} name={`gradient ${i + 1}`} hex={g} />
        ))}
      </div>

      <h3>{dict.assets}</h3>
      <p className="muted">{dict.assetsD}</p>
      <p className="footer-links" style={{ gap: 4 }}>
        <a href="/brand/logo/logo-color.svg" target="_blank" rel="noreferrer">/brand/logo/logo-color.svg</a>
        <a href="/brand/logo/logo-symbol.svg" target="_blank" rel="noreferrer">/brand/logo/logo-symbol.svg</a>
        <a href="/brand/social/profile.png" target="_blank" rel="noreferrer">/brand/social/profile.png</a>
        <a href="/brand/social/cover-facebook.png" target="_blank" rel="noreferrer">/brand/social/cover-facebook.png</a>
      </p>

      <p className="notice" style={{ marginTop: 18 }}>⚠ {dict.trademark}</p>
    </div>
  );
}
