"use client";
/**
 * Privacy-first analytics dashboard (Phase 6, feature 27): hand-rolled
 * SVG charts over the first-party event store — 30-day pageview series,
 * funnel with step conversions, top products. Zero stored events
 * renders honest empty states, never invented numbers.
 */
import { useEffect, useState } from "react";

interface DayCounts {
  day: string; pageview: number; product_view: number; add_to_cart: number;
  checkout_start: number; purchase: number; total: number; visitors: number;
}
interface FunnelStep { type: string; count: number; conversionFromPrevious: number | null }
interface TopProduct { productId: string; views: number; carts: number; purchases: number }
interface Data { series: DayCounts[]; funnel: FunnelStep[]; topProducts: TopProduct[]; totalEvents: number }

interface AnalyticsDict {
  empty: string;
  exportCsv: string;
  funnel: string;
  top: string;
  views: string;
  events: string;
  visitors: string;
}

function points(values: number[], width: number, height: number, pad = 6): string {
  const max = Math.max(...values, 0);
  if (values.length === 0 || max === 0) return "";
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => `${(pad + i * stepX).toFixed(1)},${(height - pad - (v / max) * (height - pad * 2)).toFixed(1)}`).join(" ");
}

export default function AnalyticsPanel({ dict }: { dict: AnalyticsDict }) {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    fetch("/api/admin/analytics")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d as Data | null))
      .catch(() => setData(null));
  }, []);

  if (!data) return <p className="muted">…</p>;
  const totalVisitors = data.series.reduce((s, d) => s + d.visitors, 0);
  const line = points(data.series.map((d) => d.pageview), 720, 160);
  const maxFunnel = Math.max(...data.funnel.map((f) => f.count), 0);

  return (
    <div>
      <div className="admin-grid">
        <div className="stat-card"><span className="muted">{dict.events}</span><strong>{data.totalEvents}</strong></div>
        <div className="stat-card"><span className="muted">{dict.visitors} (30d)</span><strong>{totalVisitors}</strong></div>
        <div className="stat-card"><span className="muted">{dict.views} (30d)</span><strong>{data.series.reduce((s, d) => s + d.pageview, 0)}</strong></div>
      </div>
      <p>
        <a className="btn btn-ghost" href="/api/admin/analytics?format=csv">{dict.exportCsv}</a>
      </p>
      {data.totalEvents === 0 ? (
        <p className="muted">{dict.empty}</p>
      ) : (
        <>
          <svg viewBox="0 0 720 160" className="analytics-chart" role="img" aria-label={dict.views}>
            <polyline points={line} fill="none" stroke="var(--gold)" strokeWidth="2" />
            {data.series.map((d, i) => {
              const max = Math.max(...data.series.map((x) => x.pageview), 1);
              const x = 6 + i * ((720 - 12) / Math.max(1, data.series.length - 1));
              const y = 160 - 6 - (d.pageview / max) * 148;
              return <circle key={d.day} cx={x} cy={y} r="2.5" fill="var(--gold)"><title>{`${d.day}: ${d.pageview}`}</title></circle>;
            })}
          </svg>
          <h3>{dict.funnel}</h3>
          <div>
            {data.funnel.map((f) => (
              <p key={f.type} className="summary-row">
                <span>{f.type}</span>
                <span>
                  <span
                    className="funnel-bar"
                    style={{ width: `${maxFunnel > 0 ? Math.max(2, (f.count / maxFunnel) * 220) : 2}px` }}
                  />
                  {f.count}
                  {f.conversionFromPrevious != null ? <span className="muted"> · {f.conversionFromPrevious}%</span> : null}
                </span>
              </p>
            ))}
          </div>
          <h3>{dict.top}</h3>
          {data.topProducts.length === 0 ? (
            <p className="muted">{dict.empty}</p>
          ) : (
            <table className="admin-table">
              <thead><tr><th>Product</th><th>{dict.views}</th><th>Cart</th><th>Buy</th></tr></thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr key={p.productId}><td>{p.productId}</td><td>{p.views}</td><td>{p.carts}</td><td>{p.purchases}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
