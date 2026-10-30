import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, isAdminSession, providerStatus } from "../../../lib/admin";
import { PRODUCTS, BUNDLES } from "../../../data/products";
import { COUPONS } from "../../../lib/coupons";
import { getDictionary } from "../../../i18n/dictionaries";
import { isStorageConfigured } from "../../../services/storage";
import { isDbConfigured } from "../../../lib/db";
import ProductFilesManager from "../../../components/ProductFilesManager";
import FeatureFlagsPanel from "../../../components/FeatureFlagsPanel";
import DeliveryChannelsPanel from "../../../components/DeliveryChannelsPanel";

export const metadata = { title: "Control", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const jar = await cookies();
  if (!isAdminSession(jar.get(ADMIN_COOKIE)?.value)) {
    redirect(`/${locale}/control-astralium/login`);
  }
  const status = providerStatus();
  const dict = getDictionary(locale);
  const storageOn = isStorageConfigured();
  const dbOn = isDbConfigured();
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

      <h2>{dict.admin_files_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_files_desc}</p>
        {!storageOn ? <p><span className="pill pill-bad">{dict.admin_files_storage_off}</span></p> : null}
        {!dbOn ? <p><span className="pill pill-bad">{dict.admin_files_db_off}</span></p> : null}
        <ProductFilesManager
          products={PRODUCTS.map((p) => ({ id: p.id, title: p.title }))}
          storageConfigured={storageOn}
          dict={{
            product: dict.admin_files_product,
            status: dict.admin_files_status,
            action: dict.admin_files_action,
            bound: dict.admin_files_bound,
            unbound: dict.admin_files_unbound,
            kindProduct: dict.admin_files_kind_product,
            kindPreview: dict.admin_files_kind_preview,
            version: dict.admin_files_version,
            upload: dict.admin_files_upload,
            uploading: dict.admin_files_uploading,
            done: dict.admin_files_done,
            error: dict.admin_files_error,
          }}
        />
      </div>

      <h2>{dict.admin_flags_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_flags_desc}</p>
        {!dbOn ? <p><span className="pill pill-bad">{dict.admin_flags_preview_note}</span></p> : null}
        <FeatureFlagsPanel
          dict={{
            on: dict.admin_flags_on,
            off: dict.admin_flags_off,
            labels: {
              delivery_email: dict.flag_delivery_email,
              delivery_whatsapp: dict.flag_delivery_whatsapp,
              delivery_messenger: dict.flag_delivery_messenger,
              delivery_instagram: dict.flag_delivery_instagram,
              social_proof: dict.flag_social_proof,
              ai_support_v2: dict.flag_ai_support_v2,
              subscriptions: dict.flag_subscriptions,
              loyalty: dict.flag_loyalty,
              referrals: dict.flag_referrals,
            },
          }}
        />
      </div>

      <h2>{dict.admin_delivery_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_delivery_desc}</p>
        <DeliveryChannelsPanel
          dict={{
            channel: dict.admin_delivery_channel,
            flag: dict.admin_delivery_flag,
            provider: dict.admin_delivery_provider,
            ready: dict.admin_delivery_ready,
            notReady: dict.admin_delivery_not_ready,
            on: dict.admin_flags_on,
            off: dict.admin_flags_off,
            template: dict.admin_delivery_template,
            templateNote: dict.admin_delivery_template_note,
            stats: dict.admin_delivery_stats,
            log: dict.admin_delivery_log,
            logEmpty: dict.admin_delivery_log_empty,
            resend: dict.admin_delivery_resend,
            order: dict.admin_delivery_order,
            status: dict.admin_delivery_status,
            when: dict.admin_delivery_when,
            labels: {
              email: dict.delivery_channel_email,
              whatsapp: dict.delivery_channel_whatsapp,
              messenger: dict.delivery_channel_messenger,
              instagram: dict.delivery_channel_instagram,
            },
          }}
        />
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
