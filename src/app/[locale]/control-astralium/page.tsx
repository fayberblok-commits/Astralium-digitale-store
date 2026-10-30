import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, isAdminSession, providerStatus } from "../../../lib/admin";
import { PRODUCTS, BUNDLES } from "../../../data/products";
import { COUPONS } from "../../../lib/coupons";

export const metadata = { title: "Control", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const jar = await cookies();
  if (!isAdminSession(jar.get(ADMIN_COOKIE)?.value)) {
    redirect(`/${locale}/control-astralium/login`);
  }
  const status = providerStatus();
  const catalogValue = PRODUCTS.reduce((s, p) => s + p.priceUSD, 0);
  const avgRating = (PRODUCTS.reduce((s, p) => s + p.rating, 0) / PRODUCTS.length).toFixed(2);

  return (
    <div style={{ marginTop: 28 }}>
      <h1>Astralium Control — Dashboard</h1>
      <p className="muted">
        Stats below come from the live data layer. Order/revenue analytics activate with the
        database adapter (orders are currently fulfilled via provider webhooks + structured logs).
      </p>

      <div className="admin-grid">
        <div className="stat-card"><span className="muted">Products</span><strong>{PRODUCTS.length}</strong></div>
        <div className="stat-card"><span className="muted">Bundles</span><strong>{BUNDLES.length}</strong></div>
        <div className="stat-card"><span className="muted">Catalog value (USD)</span><strong>${catalogValue}</strong></div>
        <div className="stat-card"><span className="muted">Average rating</span><strong>{avgRating} ★</strong></div>
        <div className="stat-card"><span className="muted">Active coupons</span><strong>{COUPONS.filter((c) => c.active).length}</strong></div>
      </div>

      <h2>Payment & service providers</h2>
      <div className="panel">
        {status.map((s) => (
          <p key={s.name} className="summary-row">
            <span>{s.name}</span>
            {s.ready ? (
              <span className="pill pill-ok">Configured</span>
            ) : (
              <span className="pill pill-bad">Missing: {s.missing.join(", ")}</span>
            )}
          </p>
        ))}
        <p className="muted">Presence is read from server environment keys only — values are never shown.</p>
      </div>

      <h2>Products</h2>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr><th>Title</th><th>Category</th><th>Price (USD)</th><th>Rating</th><th>Reviews</th><th>Badge</th></tr>
          </thead>
          <tbody>
            {PRODUCTS.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td><td>{p.category}</td><td>${p.priceUSD}</td>
                <td>{p.rating} ★</td><td>{p.reviewsCount}</td><td>{p.badge ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Coupons</h2>
      <div className="panel" style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead>
            <tr><th>Code</th><th>Type</th><th>Value</th><th>Restrictions</th><th>Status</th></tr>
          </thead>
          <tbody>
            {COUPONS.map((c) => (
              <tr key={c.code}>
                <td><code>{c.code}</code></td>
                <td>{c.type}</td>
                <td>{c.type === "percent" ? `${c.value}%` : `$${c.value}`}</td>
                <td>
                  {[c.firstOrderOnly ? "first order" : "", c.countries ? `countries: ${c.countries.join("/")}` : "", c.minSubtotalUSD ? `min $${c.minSubtotalUSD}` : "", c.usageLimit ? `limit ${c.usageLimit}` : ""].filter(Boolean).join(" · ") || "—"}
                </td>
                <td>{c.active ? <span className="pill pill-ok">Active</span> : <span className="pill pill-bad">Paused</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Settings overview</h2>
      <div className="panel">
        <p className="muted">
          Store identity, taxes, domains, email and integrations are configured through
          environment variables in this release (see <code>.env.example</code> and
          <code> docs/ADMIN_GUIDE.md</code>). Visual theme tokens live in
          <code> src/app/globals.css</code>. A database-backed settings UI ships with the
          Postgres adapter phase.
        </p>
      </div>
    </div>
  );
}
