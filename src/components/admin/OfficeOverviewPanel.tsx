"use client";

/**
 * Manager's Office — live overview (Phase 4 upgrade, item 1).
 * First-party analytics only; whatever the API returns is what is
 * shown — with zero traffic the owner sees honest empty states.
 */
import { useEffect, useState } from "react";
import { COUNTRY_GEO, countryName, projectToSvg } from "../../lib/countries-geo";

export interface OverviewDict {
  loading: string; empty: string; now: string; today: string; week: string; month: string;
  visitors: string; uniques: string; views: string; countries: string; devices: string;
  browsers: string; sources: string; topPages: string; funnel: string; conversion: string;
  funnelSteps: string[];
}

interface RangeStats { pageviews: number; events: number; visitors: number; productViews: number; purchases: number }
interface OverviewData {
  activeNow: number;
  ranges: { today: RangeStats; week: RangeStats; month: RangeStats };
  countries: { key: string; count: number }[];
  devices: { key: string; count: number }[];
  browsers: { key: string; count: number }[];
  sources: { key: string; count: number }[];
  topPages: { path: string; views: number; visitors: number }[];
  funnel: { type: string; count: number }[];
  conversionRate: number;
  totalEvents30d: number;
}

function Bars({ rows, label }: { rows: { key: string; count: number }[]; label: (k: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return null;
  return (
    <div className="office-bars">
      {rows.map((r) => (
        <div key={r.key} className="office-bar-row">
          <span className="office-bar-label">{label(r.key)}</span>
          <span className="office-bar-track"><span className="office-bar-fill" style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <strong>{r.count}</strong>
        </div>
      ))}
    </div>
  );
}

export default function OfficeOverviewPanel({ dict }: { dict: OverviewDict }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/office/overview")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<OverviewData>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">{dict.loading}</p>;

  const ranges: { label: string; stats: RangeStats }[] = [
    { label: dict.today, stats: data.ranges.today },
    { label: dict.week, stats: data.ranges.week },
    { label: dict.month, stats: data.ranges.month },
  ];
  const maxCountry = Math.max(1, ...data.countries.map((c) => c.count));
  const funnelMax = Math.max(1, ...data.funnel.map((f) => f.count));

  return (
    <div>
      <div className="admin-grid">
        <div className="stat-card"><span className="muted">{dict.now}</span><strong>{data.activeNow}</strong></div>
        {ranges.map((r) => (
          <div key={r.label} className="stat-card">
            <span className="muted">{r.label}</span>
            <strong>{r.stats.visitors}</strong>
            <span className="muted">{dict.uniques} · {r.stats.pageviews} {dict.views}</span>
          </div>
        ))}
        <div className="stat-card"><span className="muted">{dict.conversion}</span><strong>{data.conversionRate}%</strong></div>
      </div>

      {data.totalEvents30d === 0 ? (
        <p className="muted">{dict.empty}</p>
      ) : (
        <>
          <h3>{dict.countries}</h3>
          <div className="office-map-wrap">
            <svg viewBox="0 0 1000 520" className="office-map" role="img" aria-label={dict.countries}>
              {Object.entries(COUNTRY_GEO).map(([code, g]) => {
                const { x, y } = projectToSvg(g.lat, g.lon, 1000, 520);
                return <circle key={code} cx={x} cy={y} r={3} className="office-map-dot-bg" />;
              })}
              {data.countries.map((c) => {
                const geo = COUNTRY_GEO[c.key.toUpperCase()];
                if (!geo) return null;
                const { x, y } = projectToSvg(geo.lat, geo.lon, 1000, 520);
                return (
                  <circle key={c.key} cx={x} cy={y} r={4 + (c.count / maxCountry) * 10} className="office-map-dot">
                    <title>{countryName(c.key)}: {c.count}</title>
                  </circle>
                );
              })}
            </svg>
          </div>
          <Bars rows={data.countries} label={(k) => countryName(k)} />

          <div className="office-cols">
            <div>
              <h3>{dict.devices}</h3>
              <Bars rows={data.devices} label={(k) => k} />
              <h3>{dict.browsers}</h3>
              <Bars rows={data.browsers} label={(k) => k} />
            </div>
            <div>
              <h3>{dict.sources}</h3>
              <Bars rows={data.sources} label={(k) => k} />
              <h3>{dict.topPages}</h3>
              <div className="office-bars">
                {data.topPages.map((p) => (
                  <div key={p.path} className="office-bar-row">
                    <span className="office-bar-label"><code>{p.path}</code></span>
                    <strong>{p.views}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <h3>{dict.funnel}</h3>
          <div className="office-bars">
            {data.funnel.map((f, i) => (
              <div key={f.type} className="office-bar-row">
                <span className="office-bar-label">{dict.funnelSteps[i] ?? f.type}</span>
                <span className="office-bar-track"><span className="office-bar-fill" style={{ width: `${(f.count / funnelMax) * 100}%` }} /></span>
                <strong>{f.count}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
