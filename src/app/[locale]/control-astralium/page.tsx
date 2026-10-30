import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, providerStatus } from "../../../lib/admin";
import { actorFromCookie } from "../../../lib/team";
import { PRODUCTS, BUNDLES } from "../../../data/products";
import { COUPONS } from "../../../lib/coupons";
import { getDictionary } from "../../../i18n/dictionaries";
import { isStorageConfigured } from "../../../services/storage";
import { isDbConfigured } from "../../../lib/db";
import ProductFilesManager from "../../../components/ProductFilesManager";
import FeatureFlagsPanel from "../../../components/FeatureFlagsPanel";
import DeliveryChannelsPanel from "../../../components/DeliveryChannelsPanel";
import BundlesManager from "../../../components/BundlesManager";
import OffersManager from "../../../components/OffersManager";
import FlashSalesManager from "../../../components/FlashSalesManager";
import CommerceManager from "../../../components/CommerceManager";
import ReviewsModeration from "../../../components/ReviewsModeration";
import VersionsPublisher from "../../../components/VersionsPublisher";
import LicenseManager from "../../../components/LicenseManager";
import FraudManager from "../../../components/FraudManager";
import BlogManager from "../../../components/BlogManager";
import AbManager from "../../../components/AbManager";
import OwnerAlertsPanel from "../../../components/OwnerAlertsPanel";
import AnalyticsPanel from "../../../components/AnalyticsPanel";
import TeamManager from "../../../components/TeamManager";
import AuditPanel from "../../../components/AuditPanel";
import PushManager from "../../../components/PushManager";
import PrivacySettingsPanel from "../../../components/PrivacySettingsPanel";
import { LOCALE_CODES } from "../../../i18n/locales";

export const metadata = { title: "Control", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const jar = await cookies();
  // Phase 6 (feature 29): the bootstrap ADMIN_PASSWORD session and team
  // sessions both resolve to an actor with a role; neither → login.
  const actor = actorFromCookie(jar.get(ADMIN_COOKIE)?.value);
  if (!actor) {
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
      <p className="muted">
        Signed in as <strong>{actor.actor}</strong> · role <strong>{actor.role}</strong>
        {actor.via === "password" ? " (bootstrap owner)" : ""}
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
              library: dict.flag_library,
              previews: dict.flag_previews,
              bundles: dict.flag_bundles,
              recommendations: dict.flag_recommendations,
              smart_search: dict.flag_smart_search,
              reviews: dict.flag_reviews,
              order_bump: dict.flag_order_bump,
              wishlist_alerts: dict.flag_wishlist_alerts,
              flash_sales: dict.flag_flash_sales,
              gifts: dict.flag_gifts,
              pwyw: dict.flag_pwyw,
              preorders: dict.flag_preorders,
              express_pay: dict.flag_express_pay,
              receipts: dict.flag_receipts,
              watermarking: dict.flag_watermarking,
              license_keys: dict.flag_license_keys,
              fraud_shield: dict.flag_fraud_shield,
              email_automation: dict.flag_email_automation,
              blog: dict.flag_blog,
              seo_engine: dict.flag_seo_engine,
              ab_tests: dict.flag_ab_tests,
              owner_alerts: dict.flag_owner_alerts,
              analytics: dict.flag_analytics,
              pwa_push: dict.flag_pwa_push,
              team_access: dict.flag_team_access,
              privacy_center: dict.flag_privacy_center,
            },
          }}
        />
      </div>

      <h2>{dict.admin_bundles_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_bundles_desc}</p>
        <BundlesManager
          dict={{
            name: dict.admin_bundles_name,
            discount: dict.admin_bundles_discount,
            products: dict.admin_bundles_products,
            active: dict.admin_bundles_active,
            save: dict.admin_bundles_save,
            delete: dict.admin_bundles_delete,
            derived: dict.admin_bundles_derived,
          }}
        />
      </div>

      <h2>{dict.admin_offers_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_offers_desc}</p>
        <OffersManager
          products={PRODUCTS.map((p) => ({ id: p.id, title: p.title }))}
          dict={{
            product: dict.admin_offers_product,
            bump: dict.admin_offers_bump,
            upsell: dict.admin_offers_upsell,
            save: dict.admin_offers_save,
            saved: dict.admin_offers_saved,
          }}
        />
      </div>

      <h2>{dict.admin_flash_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_flash_desc}</p>
        <FlashSalesManager
          dict={{
            name: dict.admin_flash_name,
            discount: dict.admin_flash_discount,
            products: dict.admin_flash_products,
            start: dict.admin_flash_start,
            end: dict.admin_flash_end,
            cap: dict.admin_flash_cap,
            active: dict.admin_flash_active,
            save: dict.admin_flash_save,
            delete: dict.admin_flash_delete,
            state: dict.admin_flash_state,
          }}
        />
      </div>

      <h2>{dict.admin_commerce_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_commerce_desc}</p>
        <CommerceManager
          products={PRODUCTS.map((p) => ({ id: p.id, title: p.title }))}
          dict={{
            save: dict.admin_commerce_save,
            saved: dict.admin_commerce_saved,
            pwywFor: dict.admin_pwyw_for,
            pwywMin: dict.admin_pwyw_min,
            pwywSuggested: dict.admin_pwyw_suggested,
            preorderDate: dict.admin_preorder_date,
            planInterval: dict.admin_plan_interval,
            planPrice: dict.admin_plan_price,
            loyaltyEarn: dict.admin_loyalty_earn,
            loyaltyMax: dict.admin_loyalty_max,
            referralPercent: dict.admin_referral_percent,
            commissionsTitle: dict.admin_commissions_title,
            commissionsEmpty: dict.admin_commissions_empty,
          }}
        />
        <p className="muted">{dict.admin_commissions_desc}</p>
      </div>

      <h2>{dict.library_t} — {dict.admin_versions_publish}</h2>
      <div className="panel">
        <VersionsPublisher
          products={PRODUCTS.map((p) => ({ id: p.id, title: p.title }))}
          dict={{
            publish: dict.admin_versions_publish,
            notes: dict.admin_versions_notes,
            done: dict.admin_versions_done,
            version: dict.library_version,
            product: dict.admin_offers_product,
          }}
        />
      </div>

      <h2>{dict.admin_reviews_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_reviews_desc}</p>
        <ReviewsModeration
          dict={{
            empty: dict.admin_reviews_empty,
            approve: dict.admin_reviews_approve,
            reject: dict.admin_reviews_reject,
            verified: dict.admin_reviews_verified,
            unverified: dict.admin_reviews_unverified,
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

      <h2>{dict.admin_license_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_license_desc}</p>
        <LicenseManager
          products={PRODUCTS.map((p) => ({ id: p.id, title: p.title }))}
          dict={{
            products: dict.admin_license_products,
            limit: dict.admin_license_limit,
            save: dict.admin_commerce_save,
            saved: dict.admin_commerce_saved,
            keys: dict.admin_license_keys,
            revoke: dict.admin_license_revoke,
            empty: dict.admin_license_empty,
            status: dict.admin_delivery_status,
            activations: dict.admin_license_activations,
          }}
        />
      </div>

      <h2>{dict.admin_fraud_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_fraud_desc}</p>
        <FraudManager
          dict={{
            threshold: dict.admin_fraud_threshold,
            save: dict.admin_commerce_save,
            saved: dict.admin_commerce_saved,
            empty: dict.admin_fraud_empty,
            release: dict.admin_fraud_release,
            reject: dict.admin_fraud_reject,
            score: dict.admin_fraud_score,
            reasons: dict.admin_fraud_reasons,
            blacklist: dict.admin_fraud_blacklist,
            blacklistPh: dict.admin_fraud_blacklist_ph,
            add: dict.admin_fraud_add,
            remove: dict.admin_fraud_remove,
            rejectNote: dict.admin_fraud_reject_note,
            queue: dict.admin_fraud_queue,
          }}
        />
      </div>

      <h2>{dict.admin_blog_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_blog_desc}</p>
        <BlogManager
          locales={[...LOCALE_CODES]}
          dict={{
            save: dict.admin_blog_save,
            saved: dict.admin_commerce_saved,
            delete: dict.admin_flash_delete,
            status: dict.admin_blog_status,
            locale: dict.admin_blog_locale,
            slug: dict.admin_blog_slug,
            body: dict.admin_blog_body,
            excerpt: dict.admin_blog_excerpt,
            newPost: dict.admin_blog_new,
            title: dict.admin_flash_name,
            published: dict.admin_blog_published,
            draft: dict.admin_blog_draft,
            empty: dict.admin_blog_empty,
            edit: dict.admin_blog_edit,
          }}
        />
      </div>

      <h2>{dict.admin_ab_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_ab_desc}</p>
        <AbManager
          dict={{
            save: dict.admin_commerce_save,
            saved: dict.admin_commerce_saved,
            name: dict.admin_flash_name,
            variants: dict.admin_ab_variants,
            status: dict.admin_blog_status,
            results: dict.admin_ab_results,
            exposures: dict.admin_ab_exposures,
            conversions: dict.admin_ab_conversions,
            rate: dict.admin_ab_rate,
            significant: dict.admin_ab_significant,
            notSignificant: dict.admin_ab_not_significant,
            empty: dict.admin_blog_empty,
            addExperiment: dict.admin_ab_add,
            headline: dict.admin_ab_headline,
            weight: dict.admin_ab_weight,
            variantKey: dict.admin_ab_variant,
          }}
        />
      </div>

      <h2>{dict.admin_alerts_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_alerts_desc}</p>
        <OwnerAlertsPanel
          dict={{
            empty: dict.admin_alerts_empty,
            markAll: dict.admin_alerts_mark_all,
            unread: dict.admin_alerts_unread,
            filterAll: dict.admin_alerts_filter_all,
            emailPh: dict.admin_alerts_email,
            whatsappPh: dict.admin_alerts_whatsapp,
            telegram: dict.admin_alerts_telegram,
            save: dict.admin_commerce_save,
            saved: dict.admin_commerce_saved,
            kinds: {
              order_paid: dict.admin_alerts_kind_order_paid,
              fraud_hold: dict.admin_alerts_kind_fraud_hold,
              delivery_failed: dict.admin_alerts_kind_delivery_failed,
              review_pending: dict.admin_alerts_kind_review_pending,
              subscription_past_due: dict.admin_alerts_kind_subscription_past_due,
            },
          }}
        />
      </div>

      <h2>{dict.admin_analytics_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_analytics_desc}</p>
        <AnalyticsPanel
          dict={{
            empty: dict.admin_analytics_empty,
            exportCsv: dict.admin_analytics_export_csv,
            funnel: dict.admin_analytics_funnel,
            top: dict.admin_analytics_top,
            views: dict.admin_analytics_views,
            events: dict.admin_analytics_events,
            visitors: dict.admin_analytics_visitors,
          }}
        />
      </div>

      <h2>{dict.admin_team_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_team_desc}</p>
        <TeamManager
          dict={{
            email: dict.admin_team_email,
            role: dict.admin_team_role,
            add: dict.admin_team_add,
            twoFa: dict.admin_team_2fa,
            enroll: dict.admin_team_enroll,
            secret: dict.admin_team_secret,
            codePh: dict.admin_team_code_ph,
            confirm: dict.admin_team_confirm,
            backup: dict.admin_team_backup,
            disable2fa: dict.admin_team_disable2fa,
            delete: dict.admin_team_delete,
            saved: dict.admin_commerce_saved,
            passwordPh: dict.admin_team_password_ph,
            ownerOnly: dict.admin_team_owner_only,
            enabled: dict.admin_team_enabled,
          }}
        />
      </div>

      <h2>{dict.admin_audit_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_audit_desc}</p>
        <AuditPanel dict={{ empty: dict.admin_audit_empty }} />
      </div>

      <h2>{dict.admin_push_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_push_desc}</p>
        <PushManager
          dict={{
            subscribers: dict.admin_push_subscribers,
            titlePh: dict.admin_push_title_ph,
            bodyPh: dict.admin_push_body_ph,
            urlPh: dict.admin_push_url_ph,
            confirm: dict.admin_push_confirm,
            send: dict.admin_push_send,
            sent: dict.admin_push_sent,
            notConfigured: dict.admin_push_not_configured,
          }}
        />
      </div>

      <h2>{dict.admin_privacy_title}</h2>
      <div className="panel">
        <p className="muted">{dict.admin_privacy_desc}</p>
        <PrivacySettingsPanel
          dict={{
            retention: dict.admin_privacy_retention,
            save: dict.admin_commerce_save,
            saved: dict.admin_commerce_saved,
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
