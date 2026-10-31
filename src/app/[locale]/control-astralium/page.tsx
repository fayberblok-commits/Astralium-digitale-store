import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, providerStatus } from "../../../lib/admin";
import { actorFromCookie, can } from "../../../lib/team";
import { PRODUCTS, BUNDLES, CATEGORIES } from "../../../data/products";
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
import SecurityPanel from "../../../components/SecurityPanel";
import PrivacySettingsPanel from "../../../components/PrivacySettingsPanel";
import ThemePanel from "../../../components/ThemePanel";
import HomeSectionsPanel from "../../../components/HomeSectionsPanel";
import BrandGuidePanel from "../../../components/BrandGuidePanel";
import OfficeShell, { type OfficeSection } from "../../../components/admin/OfficeShell";
import OfficeOverviewPanel from "../../../components/admin/OfficeOverviewPanel";
import SalesPanel from "../../../components/admin/SalesPanel";
import OrdersPanel from "../../../components/admin/OrdersPanel";
import CustomersPanel from "../../../components/admin/CustomersPanel";
import ProductsManager from "../../../components/admin/ProductsManager";
import CouponsPanel from "../../../components/admin/CouponsPanel";
import TicketsPanel from "../../../components/admin/TicketsPanel";
import BankVaultPanel from "../../../components/admin/BankVaultPanel";
import BannerHeroPanel from "../../../components/admin/BannerHeroPanel";
import DesignVersionsPanel from "../../../components/admin/DesignVersionsPanel";
import OfficeSecurityPanel from "../../../components/admin/OfficeSecurityPanel";
import AiStaffPanel from "../../../components/admin/AiStaffPanel";
import { getThemeSettings } from "../../../lib/theme-settings";
import { getPalette, PALETTE_IDS } from "../../../lib/themes";
import { LOCALE_CODES } from "../../../i18n/locales";

export const metadata = { title: "Control", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The Manager's Office (Phase 4 upgrade). Same invisible,
 * env-path-configured route as before (noindex, no storefront links);
 * the page now groups every console system into office sections.
 * Sections are filtered SERVER-SIDE by the actor's permissions —
 * money (finance), bank and the security center never even render
 * for roles that may not see them, and their APIs enforce the same
 * matrix again per request.
 */
export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const jar = await cookies();
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
  const themeSettings = await getThemeSettings();

  const stepUpDict = {
    title: dict.admin_security_stepup,
    password: dict.admin_security_password,
    code: dict.admin_security_totp_code,
    submit: dict.admin_security_stepup,
    done: dict.admin_security_stepup_done,
  };
  const productRefs = PRODUCTS.map((p) => ({ id: p.id, title: p.title }));

  const sections: OfficeSection[] = [];

  sections.push({
    id: "overview",
    label: dict.office_sec_overview,
    node: (
      <div>
        <div className="admin-grid">
          <div className="stat-card"><span className="muted">Products</span><strong>{PRODUCTS.length}</strong></div>
          <div className="stat-card"><span className="muted">Bundles</span><strong>{BUNDLES.length}</strong></div>
          <div className="stat-card"><span className="muted">Catalog value (USD)</span><strong>${catalogValue}</strong></div>
          <div className="stat-card"><span className="muted">Average rating</span><strong>{avgRating} ★</strong></div>
          <div className="stat-card"><span className="muted">Active coupons</span><strong>{COUPONS.filter((c) => c.active).length}</strong></div>
        </div>
        <OfficeOverviewPanel
          dict={{
            loading: dict.office_loading, empty: dict.office_empty, now: dict.office_now,
            today: dict.office_today, week: dict.office_week, month: dict.office_month,
            visitors: dict.office_visitors, uniques: dict.office_uniques, views: dict.office_views,
            countries: dict.office_countries, devices: dict.office_devices, browsers: dict.office_browsers,
            sources: dict.office_sources, topPages: dict.office_top_pages, funnel: dict.office_funnel,
            conversion: dict.office_conversion,
            funnelSteps: [dict.office_f_visit, dict.office_f_product, dict.office_f_cart, dict.office_f_checkout, dict.office_f_purchase],
          }}
        />
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
      </div>
    ),
  });

  if (can(actor.role, "finance")) {
    sections.push({
      id: "sales",
      label: dict.office_sec_sales,
      node: (
        <div className="panel">
          <SalesPanel
            dict={{
              loading: dict.office_loading, gross: dict.office_gross, netProfit: dict.office_net_profit,
              refunds: dict.office_refunds, fees: dict.office_fees, taxes: dict.office_taxes,
              costs: dict.office_costs, adspend: dict.office_adspend, fulfilled: dict.office_st_fulfilled,
              pending: dict.office_st_pending, cancelled: dict.office_st_cancelled,
              refunded: dict.office_st_refunded, disputed: dict.office_st_disputed,
              byProduct: dict.office_by_product, byCountry: dict.office_by_country,
              byLanguage: dict.office_by_language, byCurrency: dict.office_by_currency,
              prev: dict.office_prev, csv: dict.office_csv, feeSettings: dict.office_fee_settings,
              estimatesNote: dict.office_estimates_note, from: dict.office_range_from, to: dict.office_range_to,
              apply: dict.office_apply, adspendAdd: dict.office_adspend_add, units: dict.office_units,
              saved: dict.office_saved,
            }}
          />
        </div>
      ),
    });
  }

  sections.push({
    id: "orders",
    label: dict.office_sec_orders,
    node: (
      <div>
        <div className="panel">
          <OrdersPanel
            dict={{
              loading: dict.office_loading, searchPh: dict.office_search_orders,
              allStatuses: dict.office_all_statuses, detail: dict.office_detail,
              resend: dict.office_resend, resent: dict.office_resent, refund: dict.office_refund,
              refundFull: dict.office_refund_full, refundPartial: dict.office_refund_partial,
              refundAmount: dict.office_refund_amount, refundDone: dict.office_refund_done,
              note: dict.office_note, noteSave: dict.office_note_save, grants: dict.office_grants,
              downloadsUsed: dict.office_downloads_left, saved: dict.office_saved, stepUp: stepUpDict,
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
            products={productRefs}
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
      </div>
    ),
  });

  sections.push({
    id: "customers",
    label: dict.office_sec_customers,
    node: (
      <div>
        <div className="panel">
          <CustomersPanel
            dict={{
              loading: dict.office_loading, customer: dict.office_customer,
              totalSpend: dict.office_total_spend, ordersCount: dict.office_orders_count,
              lastOrder: dict.office_last_order, ban: dict.office_ban, unban: dict.office_unban,
              banned: dict.office_banned, empty: dict.office_empty,
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
      </div>
    ),
  });

  sections.push({
    id: "products",
    label: dict.office_sec_products,
    node: (
      <div>
        <div className="panel">
          <ProductsManager
            categories={CATEGORIES.map((c) => c.id)}
            dict={{
              loading: dict.office_loading, saved: dict.office_saved, save: dict.office_save,
              title: dict.office_field_title, price: dict.office_price, compareAt: dict.office_compare_at,
              cost: dict.office_cost, category: dict.sec_categories, badge: dict.office_coupon_type,
              language: dict.office_by_language, publishAt: dict.office_publish_at,
              active: dict.office_coupon_active, duplicate: dict.office_duplicate, create: dict.office_create,
              slug: dict.admin_blog_slug, overrides: dict.office_price_overrides,
              translations: dict.office_translations, addRow: dict.office_add_row,
              none: "—", source: dict.office_source, subtitle: dict.office_subtitle,
              description: dict.office_description,
            }}
          />
        </div>
        <h2>{dict.admin_files_title}</h2>
        <div className="panel">
          <p className="muted">{dict.admin_files_desc}</p>
          {!storageOn ? <p><span className="pill pill-bad">{dict.admin_files_storage_off}</span></p> : null}
          {!dbOn ? <p><span className="pill pill-bad">{dict.admin_files_db_off}</span></p> : null}
          <ProductFilesManager
            products={productRefs}
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
        <h2>{dict.library_t} — {dict.admin_versions_publish}</h2>
        <div className="panel">
          <VersionsPublisher
            products={productRefs}
            dict={{
              publish: dict.admin_versions_publish,
              notes: dict.admin_versions_notes,
              done: dict.admin_versions_done,
              version: dict.library_version,
              product: dict.admin_offers_product,
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
            products={productRefs}
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
            products={productRefs}
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
      </div>
    ),
  });

  sections.push({
    id: "design",
    label: dict.office_sec_design,
    node: (
      <div>
        <h2>{dict.admin_theme_title}</h2>
        <div className="panel">
          <p className="muted">{dict.admin_theme_desc}</p>
          <ThemePanel
            dict={{
              palette: dict.admin_theme_palette,
              mode: dict.admin_theme_mode,
              modeLight: dict.admin_theme_mode_light,
              modeDark: dict.admin_theme_mode_dark,
              modeSystem: dict.admin_theme_mode_system,
              motion: dict.admin_theme_motion,
              motionHint: dict.admin_theme_motion_hint,
              save: dict.admin_theme_save,
              saved: dict.admin_theme_saved,
              preview: dict.admin_theme_preview,
              active: dict.admin_theme_active,
              contrast: dict.admin_theme_contrast,
              contrastPass: dict.admin_theme_contrast_pass,
              names: Object.fromEntries(
                PALETTE_IDS.map((id) => [id, dict[`palette_${id.replace(/-/g, "_")}`] ?? id]),
              ),
            }}
          />
        </div>
        <div className="panel">
          <BannerHeroPanel
            dict={{
              loading: dict.office_loading, saved: dict.office_saved, save: dict.office_save,
              bannerT: dict.office_banner_t, bannerEnabled: dict.office_banner_enabled,
              bannerText: dict.office_banner_text, bannerUrl: dict.office_banner_url,
              heroT: dict.office_hero_t, heroNote: dict.office_hero_note,
              heroTitle: dict.office_field_title, heroSub: dict.office_subtitle,
            }}
          />
        </div>
        <h2>{dict.admin_home_title}</h2>
        <div className="panel">
          <p className="muted">{dict.admin_home_desc}</p>
          <HomeSectionsPanel
            dict={{
              up: dict.admin_home_up,
              down: dict.admin_home_down,
              visible: dict.admin_home_visible,
              save: dict.admin_home_save,
              saved: dict.admin_home_saved,
              names: {
                hero: dict.home_sec_hero,
                trust: dict.home_sec_trust,
                featured: dict.sec_bestsellers,
                categories: dict.sec_categories,
                bundles: dict.sec_bundles,
                new: dict.sec_new,
                how: dict.sec_how,
                guarantee: dict.guarantee_t,
                testimonials: dict.sec_testimonials,
                faq: dict.sec_faq,
                newsletter: dict.newsletter_t,
              },
            }}
          />
        </div>
        <div className="panel">
          <DesignVersionsPanel
            dict={{
              loading: dict.office_loading, versions: dict.office_versions,
              snapshot: dict.office_snapshot, snapshotName: dict.office_snapshot_name,
              rollback: dict.office_rollback, rollbackDone: dict.office_rollback_done,
              palette: dict.admin_theme_palette,
            }}
          />
        </div>
        <h2>{dict.admin_brand_title}</h2>
        <div className="panel">
          <p className="muted">{dict.admin_brand_desc}</p>
          <BrandGuidePanel
            locale={locale}
            palette={getPalette(themeSettings.palette)}
            dict={{
              logo: dict.admin_brand_logo,
              colors: dict.admin_brand_colors,
              type: dict.admin_brand_type,
              typeD: dict.admin_brand_type_d,
              voice: dict.admin_brand_voice,
              tagline: dict.admin_brand_tagline,
              assets: dict.admin_brand_assets,
              assetsD: dict.admin_brand_assets_d,
              trademark: dict.admin_brand_trademark,
            }}
          />
        </div>
      </div>
    ),
  });

  if (can(actor.role, "settings")) {
    sections.push({
      id: "ai",
      label: dict.ai_t,
      node: (
        <div className="panel">
          <AiStaffPanel
            locale={locale}
            dict={{
              loading: dict.office_loading, title: dict.ai_t, sub: dict.ai_sub,
              notConfigured: dict.ai_not_configured, provider: dict.ai_provider,
              model: dict.ai_model, fallback: dict.ai_fallback, stop: dict.ai_stop,
              stopOn: dict.ai_stop_on, stopOff: dict.ai_stop_off, today: dict.ai_today,
              cost: dict.ai_cost, actionsCount: dict.ai_actions_count,
              conversationsCount: dict.ai_conversations_count, capCost: dict.ai_cap_cost,
              capActions: dict.ai_cap_actions, save: dict.ai_save, saved: dict.ai_saved,
              teamCustomer: dict.ai_team_customer, teamOwner: dict.ai_team_owner,
              tools: dict.ai_tools, instructions: dict.ai_instructions, stats: dict.ai_stats,
              chatTitle: dict.ai_chat_t, chatPh: dict.ai_chat_ph, send: dict.ai_send,
              thinking: dict.ai_thinking, pendingTitle: dict.ai_pending_t,
              nonePending: dict.ai_none_pending, apply: dict.ai_apply, approve: dict.ai_approve,
              reject: dict.ai_reject, undo: dict.ai_undo, stPreview: dict.ai_st_preview,
              stWaiting: dict.ai_st_waiting, stApplied: dict.ai_st_applied,
              stRejected: dict.ai_st_rejected, stUndone: dict.ai_st_undone,
              refusedTitle: dict.ai_refused_t, convsTitle: dict.ai_convs_t,
              flagOff: dict.ai_flag_off, mockNote: dict.ai_mock_note,
            }}
          />
        </div>
      ),
    });
  }

  sections.push({
    id: "content",
    label: dict.office_sec_content,
    node: (
      <div>
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
        <h2>{dict.office_tickets_t}</h2>
        <div className="panel">
          <TicketsPanel
            dict={{
              loading: dict.office_loading, empty: dict.office_tickets_empty,
              replyHint: dict.office_ticket_reply_hint, statusOpen: dict.office_ticket_open,
              statusAnswered: dict.office_ticket_answered, statusClosed: dict.office_ticket_closed,
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
      </div>
    ),
  });

  sections.push({
    id: "commerce",
    label: dict.office_sec_commerce,
    node: (
      <div>
        <h2>{dict.office_coupons_t}</h2>
        <div className="panel">
          <CouponsPanel
            dict={{
              loading: dict.office_loading, saved: dict.office_saved, code: dict.office_coupon_code,
              type: dict.office_coupon_type, percent: dict.office_coupon_percent,
              fixed: dict.office_coupon_fixed, value: dict.office_coupon_value,
              min: dict.office_coupon_min, add: dict.office_coupon_add, active: dict.office_coupon_active,
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
      </div>
    ),
  });

  if (can(actor.role, "bank")) {
    sections.push({
      id: "bank",
      label: dict.office_sec_bank,
      node: (
        <div className="panel">
          <h2>{dict.office_bank_title}</h2>
          <BankVaultPanel
            dict={{
              loading: dict.office_loading, title: dict.office_bank_title, desc: dict.office_bank_desc,
              holder: dict.office_bank_holder, bankName: dict.office_bank_name,
              account: dict.office_bank_account, iban: dict.office_bank_iban,
              swift: dict.office_bank_swift, currency: dict.office_bank_currency,
              notes: dict.office_bank_notes, save: dict.office_bank_save,
              reveal: dict.office_bank_reveal, hide: dict.office_bank_hide,
              empty: dict.office_bank_empty, updated: dict.office_bank_updated,
              saved: dict.office_saved, stepUp: stepUpDict,
            }}
          />
        </div>
      ),
    });
  }

  if (can(actor.role, "security") || can(actor.role, "audit")) {
    sections.push({
      id: "security",
      label: dict.office_sec_security,
      node: (
        <div>
          {can(actor.role, "security") && (
            <div className="panel">
              <OfficeSecurityPanel
                dict={{
                  loading: dict.office_loading, sessions: dict.office_sec_sessions,
                  epoch: dict.office_sec_epoch, auditSearch: dict.office_sec_audit_search,
                  backups: dict.office_sec_backups, noBackups: dict.office_sec_no_backups,
                  health: dict.office_sec_health, alerts: dict.office_sec_alerts,
                  events: dict.admin_security_events, locked: dict.admin_security_locked,
                  idle: dict.office_idle, hours: dict.office_hours_unit,
                }}
              />
            </div>
          )}
          <h2>{dict.admin_audit_title}</h2>
          <div className="panel">
            <p className="muted">{dict.admin_audit_desc}</p>
            <AuditPanel dict={{ empty: dict.admin_audit_empty }} />
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
        </div>
      ),
    });
  }

  sections.push({
    id: "team",
    label: dict.office_sec_team,
    node: (
      <div>
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
        <h2>{dict.admin_security_title}</h2>
        <SecurityPanel
          dict={{
            title: dict.admin_security_title,
            desc: dict.admin_security_desc,
            events: dict.admin_security_events,
            empty: dict.admin_security_empty,
            epoch: dict.admin_security_epoch,
            totpTitle: dict.admin_security_totp_title,
            totpOn: dict.admin_security_totp_on,
            totpOff: dict.admin_security_totp_off,
            totpBegin: dict.admin_security_totp_begin,
            totpSecret: dict.admin_security_totp_secret,
            totpCode: dict.admin_security_totp_code,
            totpConfirm: dict.admin_security_totp_confirm,
            totpBackup: dict.admin_security_totp_backup,
            totpDisable: dict.admin_security_totp_disable,
            stepup: dict.admin_security_stepup,
            stepupDone: dict.admin_security_stepup_done,
            terminate: dict.admin_security_terminate,
            terminateDone: dict.admin_security_terminate_done,
            locked: dict.admin_security_locked,
            password: dict.admin_security_password,
          }}
        />
        <h2>Settings overview</h2>
        <div className="panel">
          <p className="muted">
            Store identity, taxes, domains, email and integrations are configured through
            environment variables in this release (see <code>.env.example</code> and
            <code> docs/ADMIN_GUIDE.md</code>). The visual theme is chosen in the
            design section (palettes are defined in <code>src/lib/themes.ts</code> and
            persist server-side); feature flags persist through the database adapter
            when one is configured.
          </p>
        </div>
      </div>
    ),
  });

  return (
    <OfficeShell
      title={dict.office_t}
      signedInAs={
        <>
          Signed in as <strong>{actor.actor}</strong> · role <strong>{actor.role}</strong>
          {actor.via === "password" ? " (bootstrap owner)" : ""}
        </>
      }
      sections={sections}
    />
  );
}
