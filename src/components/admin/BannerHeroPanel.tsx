"use client";

/**
 * Manager's Office — banner & hero texts (Phase 4 upgrade, item 5).
 * Edits the design pieces that live outside the theme/sections
 * systems: the announcement banner and the homepage hero override.
 * Both are bilingual-field settings (English + Arabic natively, the
 * same convention as the rest of the store's owner content). Saves go
 * through /api/admin/office/design (`settings` permission,
 * audit-logged) and apply to the storefront immediately.
 */
import { useEffect, useState } from "react";

export interface BannerHeroDict {
  loading: string; saved: string; save: string; bannerT: string; bannerEnabled: string;
  bannerText: string; bannerUrl: string; heroT: string; heroNote: string;
  heroTitle: string; heroSub: string;
}

interface BannerState { enabled: boolean; textEn: string; textAr: string; url: string }
interface HeroState { titleEn: string; titleAr: string; subEn: string; subAr: string }

export default function BannerHeroPanel({ dict }: { dict: BannerHeroDict }) {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [hero, setHero] = useState<HeroState>({ titleEn: "", titleAr: "", subEn: "", subAr: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/office/design")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ state: { banner: BannerState; heroText: HeroState } }>;
      })
      .then((d) => { setBanner(d.state.banner); setHero(d.state.heroText); })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function post(body: unknown) {
    const res = await fetch("/api/admin/office/design", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    setNotice(dict.saved);
  }

  if (!banner) return <p className="muted">{error ?? dict.loading}</p>;
  return (
    <div>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}

      <h3>{dict.bannerT}</h3>
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void post({ action: "banner", banner }); }}>
        <label className="office-check">
          <input type="checkbox" checked={banner.enabled} onChange={(e) => setBanner({ ...banner, enabled: e.target.checked })} />
          {dict.bannerEnabled}
        </label>
        <label>{dict.bannerText} (EN)
          <input value={banner.textEn} onChange={(e) => setBanner({ ...banner, textEn: e.target.value })} maxLength={200} />
        </label>
        <label>{dict.bannerText} (AR)
          <input value={banner.textAr} onChange={(e) => setBanner({ ...banner, textAr: e.target.value })} maxLength={200} />
        </label>
        <label>{dict.bannerUrl}
          <input value={banner.url} onChange={(e) => setBanner({ ...banner, url: e.target.value })} maxLength={300} />
        </label>
        <div className="btn-row"><button type="submit" className="btn btn-primary">{dict.save}</button></div>
      </form>

      <h3>{dict.heroT}</h3>
      <p className="muted">{dict.heroNote}</p>
      <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void post({ action: "hero", heroText: hero }); }}>
        <label>{dict.heroTitle} (EN)<input value={hero.titleEn} onChange={(e) => setHero({ ...hero, titleEn: e.target.value })} maxLength={160} /></label>
        <label>{dict.heroTitle} (AR)<input value={hero.titleAr} onChange={(e) => setHero({ ...hero, titleAr: e.target.value })} maxLength={160} /></label>
        <label>{dict.heroSub} (EN)<textarea value={hero.subEn} rows={2} onChange={(e) => setHero({ ...hero, subEn: e.target.value })} maxLength={400} /></label>
        <label>{dict.heroSub} (AR)<textarea value={hero.subAr} rows={2} onChange={(e) => setHero({ ...hero, subAr: e.target.value })} maxLength={400} /></label>
        <div className="btn-row"><button type="submit" className="btn btn-primary">{dict.save}</button></div>
      </form>
    </div>
  );
}
