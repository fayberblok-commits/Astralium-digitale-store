#!/usr/bin/env node
/**
 * i18n coverage check for the Phase-1 admin UI keys.
 *
 * For every one of the 40 locales: verifies each new key RESOLVES through
 * getDictionary() (English fallback merge) and reports how many keys are
 * native to that locale vs. served by the English fallback. Honest by
 * design: fallback is counted, not hidden.
 *
 * Hard-fails only when English or Arabic lack a new key natively (both are
 * required complete for new UI), or when any locale fails to resolve a key.
 *
 * Usage: node scripts/check-i18n.mjs
 */
import { getDictionary, NATIVE_DICTS } from "../src/i18n/dictionaries.ts";
import { LOCALES } from "../src/i18n/locales.ts";

const NEW_KEYS = [
  "admin_security_title", "admin_security_desc", "admin_security_events", "admin_security_empty", "admin_security_epoch", "admin_security_totp_title", "admin_security_totp_on", "admin_security_totp_off", "admin_security_totp_begin", "admin_security_totp_secret", "admin_security_totp_code", "admin_security_totp_confirm", "admin_security_totp_backup", "admin_security_totp_disable", "admin_security_stepup", "admin_security_stepup_done", "admin_security_terminate", "admin_security_terminate_done", "admin_security_locked", "admin_security_password",
  "admin_files_title", "admin_files_desc", "admin_files_product", "admin_files_status",
  "admin_files_action", "admin_files_bound", "admin_files_unbound", "admin_files_kind_product",
  "admin_files_kind_preview", "admin_files_version", "admin_files_choose", "admin_files_upload",
  "admin_files_uploading", "admin_files_done", "admin_files_error", "admin_files_storage_off",
  "admin_files_db_off",
  "admin_flags_title", "admin_flags_desc", "admin_flags_on", "admin_flags_off",
  "admin_flags_preview_note", "admin_flags_saved",
  "flag_delivery_email", "flag_delivery_whatsapp", "flag_delivery_messenger",
  "flag_delivery_instagram", "flag_social_proof", "flag_ai_support_v2", "flag_subscriptions",
  "flag_loyalty", "flag_referrals",
  // Phase 2: delivery channels (checkout choice, success page, admin section)
  "delivery_title", "delivery_hint", "delivery_channel_email", "delivery_channel_whatsapp",
  "delivery_channel_messenger", "delivery_channel_instagram", "delivery_phone_label",
  "delivery_phone_hint", "delivery_optin_label", "delivery_country_label",
  "success_receive_title", "success_receive_whatsapp", "success_receive_messenger",
  "success_receive_instagram", "success_email_btn", "success_email_sent",
  "success_claim_label", "success_claim_hint",
  "admin_delivery_title", "admin_delivery_desc", "admin_delivery_channel",
  "admin_delivery_flag", "admin_delivery_provider", "admin_delivery_ready",
  "admin_delivery_not_ready", "admin_delivery_template", "admin_delivery_template_note",
  "admin_delivery_stats", "admin_delivery_log", "admin_delivery_log_empty",
  "admin_delivery_resend", "admin_delivery_order", "admin_delivery_status",
  "admin_delivery_when",
  // Phase 3: library & products (flag labels, library, previews, bundles,
  // bumps/upsells, recommendations, reviews, wishlist, admin sections)
  "flag_library", "flag_previews", "flag_bundles", "flag_recommendations",
  "flag_smart_search", "flag_reviews", "flag_order_bump", "flag_wishlist_alerts",
  "library_t", "library_empty", "library_updated", "library_version", "library_notice",
  "preview_open", "preview_structure", "preview_listen",
  "byo_t", "byo_hint", "byo_progress", "byo_active", "byo_discount_label",
  "bump_t", "bump_add", "upsell_t", "upsell_cta", "upsell_no",
  "reco_t", "reco_also_bought", "reco_similar", "reco_top_rated",
  "filter_language",
  "reviews_t", "review_none", "review_verified_badge", "review_write",
  "review_rating", "review_title_ph", "review_body_ph", "review_order_ph",
  "review_email_ph", "review_submit", "review_pending_note",
  "admin_reviews_title", "admin_reviews_desc", "admin_reviews_empty",
  "admin_reviews_approve", "admin_reviews_reject", "admin_reviews_verified",
  "admin_reviews_unverified",
  "wishlist_share", "wishlist_share_copied", "wishlist_alerts_t",
  "wishlist_alerts_hint", "wishlist_alerts_btn", "wishlist_alerts_ok",
  "shared_wishlist_t",
  "admin_bundles_title", "admin_bundles_desc", "admin_bundles_name",
  "admin_bundles_discount", "admin_bundles_products", "admin_bundles_active",
  "admin_bundles_save", "admin_bundles_delete", "admin_bundles_derived",
  "admin_offers_title", "admin_offers_desc", "admin_offers_product",
  "admin_offers_bump", "admin_offers_upsell", "admin_offers_save",
  "admin_offers_saved",
  "admin_versions_publish", "admin_versions_notes", "admin_versions_done",
  // Phase 4: commerce expansion (features 9–16)
  "flag_flash_sales", "flag_gifts", "flag_pwyw", "flag_preorders",
  "flag_express_pay", "flag_receipts",
  "flash_t", "flash_ends_in", "flash_sold_out",
  "gift_t", "gift_recipient_ph", "gift_message_ph", "gift_send_date", "gift_note",
  "loyalty_t", "loyalty_balance", "loyalty_points_unit", "loyalty_redeem_label",
  "loyalty_tier_label",
  "referral_t", "referral_desc", "referral_copy", "referral_copied",
  "referral_earned", "referral_pending",
  "pwyw_t", "pwyw_hint", "pwyw_custom_ph", "pwyw_min_note",
  "preorder_badge", "preorder_releases_on", "preorder_blocked",
  "sub_t", "sub_price_note", "sub_subscribe_cta", "sub_manage_cta", "sub_unavailable",
  "receipt_download",
  "admin_flash_title", "admin_flash_desc", "admin_flash_name",
  "admin_flash_discount", "admin_flash_products", "admin_flash_start",
  "admin_flash_end", "admin_flash_cap", "admin_flash_active",
  "admin_flash_save", "admin_flash_delete", "admin_flash_state",
  "admin_commerce_title", "admin_commerce_desc", "admin_commerce_save",
  "admin_commerce_saved", "admin_pwyw_min", "admin_pwyw_suggested",
  "admin_pwyw_for", "admin_preorder_date", "admin_plan_interval",
  "admin_plan_price", "admin_loyalty_earn", "admin_loyalty_max",
  "admin_referral_percent", "admin_commissions_title",
  "admin_commissions_desc", "admin_commissions_empty",
  // Phase 5: trust & content (features 17–24)
  "flag_watermarking", "flag_license_keys", "flag_fraud_shield",
  "flag_email_automation", "flag_blog", "flag_seo_engine", "flag_ab_tests",
  "nav_blog", "blog_t", "blog_d", "blog_empty", "blog_read_more",
  "blog_published_on", "blog_back",
  "proof_downloads", "proof_orders", "proof_rating", "proof_recent_t",
  "proof_buyer", "proof_bought",
  "license_t", "license_d", "license_key_label", "license_key_ph",
  "license_device_label", "license_device_ph", "license_verify_btn",
  "license_activate_btn", "license_ok", "license_not_found",
  "license_revoked", "license_limit", "license_activations",
  "license_already", "license_rate_limited",
  "cart_recovered",
  "admin_license_title", "admin_license_desc", "admin_license_products",
  "admin_license_limit", "admin_license_keys", "admin_license_revoke",
  "admin_license_empty", "admin_license_activations",
  "admin_fraud_title", "admin_fraud_desc", "admin_fraud_threshold",
  "admin_fraud_queue", "admin_fraud_empty", "admin_fraud_release",
  "admin_fraud_reject", "admin_fraud_score", "admin_fraud_reasons",
  "admin_fraud_blacklist", "admin_fraud_blacklist_ph", "admin_fraud_add",
  "admin_fraud_remove", "admin_fraud_reject_note",
  "admin_blog_title", "admin_blog_desc", "admin_blog_save",
  "admin_blog_status", "admin_blog_locale", "admin_blog_slug",
  "admin_blog_body", "admin_blog_excerpt", "admin_blog_new",
  "admin_blog_published", "admin_blog_draft", "admin_blog_empty",
  "admin_blog_edit",
  "admin_ab_title", "admin_ab_desc", "admin_ab_variants",
  "admin_ab_results", "admin_ab_exposures", "admin_ab_conversions",
  "admin_ab_rate", "admin_ab_significant", "admin_ab_not_significant",
  "admin_ab_add", "admin_ab_headline", "admin_ab_weight", "admin_ab_variant",
  // Phase 6: platform (features 25–30)
  "flag_owner_alerts", "flag_analytics", "flag_pwa_push", "flag_team_access",
  "flag_privacy_center",
  "chat_track_order", "chat_order_id_ph", "chat_email_ph", "chat_voice",
  "chat_listening",
  "push_t", "push_d", "push_enable", "push_enabled", "push_disable",
  "push_unsupported", "push_error",
  "install_t", "install_d", "install_btn", "install_dismiss",
  "pc_t", "pc_d", "pc_disabled", "pc_export_t", "pc_export_d", "pc_email_ph",
  "pc_request_btn", "pc_sent", "pc_delete_t", "pc_delete_d", "pc_delete_warn",
  "pc_delete_btn", "pc_consent_t", "pc_consent_d", "pc_consent_analytics",
  "pc_consent_marketing", "pc_consent_save", "pc_consent_saved",
  "pc_token_invalid", "pc_export_ready", "pc_download_json",
  "pc_delete_confirm_t", "pc_delete_confirm_d", "pc_delete_execute",
  "pc_delete_done",
  "admin_alerts_title", "admin_alerts_desc", "admin_alerts_empty",
  "admin_alerts_mark_all", "admin_alerts_unread", "admin_alerts_filter_all",
  "admin_alerts_email", "admin_alerts_whatsapp", "admin_alerts_telegram",
  "admin_alerts_kind_order_paid", "admin_alerts_kind_fraud_hold",
  "admin_alerts_kind_delivery_failed", "admin_alerts_kind_review_pending",
  "admin_alerts_kind_subscription_past_due",
  "admin_analytics_title", "admin_analytics_desc", "admin_analytics_empty",
  "admin_analytics_export_csv", "admin_analytics_funnel", "admin_analytics_top",
  "admin_analytics_views", "admin_analytics_events", "admin_analytics_visitors",
  "admin_team_title", "admin_team_desc", "admin_team_email", "admin_team_role",
  "admin_team_add", "admin_team_2fa", "admin_team_enroll", "admin_team_secret",
  "admin_team_code_ph", "admin_team_confirm", "admin_team_backup",
  "admin_team_disable2fa", "admin_team_delete", "admin_team_password_ph",
  "admin_team_owner_only", "admin_team_enabled",
  "admin_audit_title", "admin_audit_desc", "admin_audit_empty",
  "admin_push_title", "admin_push_desc", "admin_push_subscribers",
  "admin_push_title_ph", "admin_push_body_ph", "admin_push_url_ph",
  "admin_push_confirm", "admin_push_send", "admin_push_sent",
  "admin_push_not_configured",
  "admin_privacy_title", "admin_privacy_desc", "admin_privacy_retention",
  // Phase 2 upgrade: themes, brand & homepage motion
  "palette_maison_classic", "palette_aurora_dawn", "palette_tropical_glow",
  "palette_cosmic_candy", "palette_emerald_gold", "palette_electric_blue",
  "admin_theme_title", "admin_theme_desc", "admin_theme_palette", "admin_theme_mode",
  "admin_theme_mode_light", "admin_theme_mode_dark", "admin_theme_mode_system",
  "admin_theme_motion", "admin_theme_motion_hint", "admin_theme_save", "admin_theme_saved",
  "admin_theme_preview", "admin_theme_active", "admin_theme_contrast", "admin_theme_contrast_pass",
  "admin_brand_title", "admin_brand_desc", "admin_brand_logo", "admin_brand_colors",
  "admin_brand_type", "admin_brand_type_d", "admin_brand_voice", "admin_brand_tagline",
  "admin_brand_assets", "admin_brand_assets_d", "admin_brand_trademark",
  "hero_stat_products", "hero_stat_languages", "hero_stat_rating", "hero_stat_guarantee",
  // Phase 3 upgrade: homepage layout, luxury cards, catalog, product page
  "quick_view", "quick_close", "discount_off", "view_grid", "view_list",
  "filters_t", "filters_apply", "collections_t", "col_under25", "col_toprated",
  "sort_popularity", "cat_products", "gallery_t", "home_sec_hero", "home_sec_trust",
  "admin_home_title", "admin_home_desc", "admin_home_up", "admin_home_down",
  "admin_home_visible", "admin_home_save", "admin_home_saved",
  // Phase 4 upgrade: the Manager's Office + support intake
  "office_t", "office_banner_label", "office_sec_overview", "office_sec_sales",
  "office_sec_orders", "office_sec_customers", "office_sec_products", "office_sec_design",
  "office_sec_content", "office_sec_commerce", "office_sec_bank", "office_sec_security",
  "office_sec_team", "office_loading", "office_saved", "office_save", "office_now",
  "office_today", "office_week", "office_month", "office_visitors", "office_uniques",
  "office_views", "office_countries", "office_devices", "office_browsers", "office_sources",
  "office_top_pages", "office_funnel", "office_conversion", "office_empty",
  "office_f_visit", "office_f_product", "office_f_cart", "office_f_checkout", "office_f_purchase",
  "office_gross", "office_net_profit", "office_fees", "office_taxes", "office_costs",
  "office_adspend", "office_st_fulfilled", "office_st_pending", "office_st_cancelled",
  "office_st_refunded", "office_st_disputed", "office_by_product", "office_by_country",
  "office_by_language", "office_by_currency", "office_prev", "office_csv",
  "office_fee_settings", "office_estimates_note", "office_range_from", "office_range_to",
  "office_apply", "office_adspend_add", "office_units", "office_subtitle", "office_description", "office_search_orders",
  "office_field_title", "office_price", "office_compare_at", "office_cost", "office_duplicate",
  "office_create", "office_price_overrides", "office_translations", "office_add_row", "office_source",
  "office_refunds", "office_publish_at", "office_idle", "office_hours_unit",
  "office_all_statuses", "office_detail", "office_resend", "office_resent", "office_refund",
  "office_refund_full", "office_refund_partial", "office_refund_amount", "office_refund_done",
  "office_note", "office_note_save", "office_grants", "office_downloads_left",
  "office_customer", "office_total_spend", "office_orders_count", "office_last_order",
  "office_ban", "office_unban", "office_banned", "office_bank_title", "office_bank_desc",
  "office_bank_holder", "office_bank_name", "office_bank_account", "office_bank_iban",
  "office_bank_swift", "office_bank_country", "office_bank_currency", "office_bank_notes", "office_bank_save",
  "office_bank_reveal", "office_bank_hide", "office_bank_empty", "office_bank_updated",
  "office_versions", "office_snapshot", "office_snapshot_name", "office_rollback",
  "office_rollback_done", "office_banner_t", "office_banner_enabled", "office_banner_text",
  "office_banner_url", "office_banner_locales", "office_hero_t", "office_hero_note",
  "office_sec_sessions", "office_sec_epoch", "office_sec_audit_search", "office_sec_backups",
  "office_sec_no_backups", "office_sec_health", "office_sec_alerts", "office_coupons_t",
  "office_coupon_code", "office_coupon_type", "office_coupon_percent", "office_coupon_fixed",
  "office_coupon_value", "office_coupon_min", "office_coupon_add", "office_coupon_active",
  "office_tickets_t", "office_tickets_empty", "office_ticket_reply_hint",
  "office_ticket_open", "office_ticket_answered", "office_ticket_closed",
  "support_t", "support_d", "support_email", "support_subject", "support_message",
  "support_order", "support_send", "support_sent",
  // Phase 5 upgrade: AI staff gateway teams.
  "flag_ai_staff", "flag_ai_owner_staff", "chat_speaking_with", "chat_listen",
  "ai_t", "ai_sub", "ai_not_configured", "ai_provider", "ai_model", "ai_fallback",
  "ai_stop", "ai_stop_on", "ai_stop_off", "ai_today", "ai_cost", "ai_actions_count",
  "ai_conversations_count", "ai_cap_cost", "ai_cap_actions", "ai_save", "ai_saved",
  "ai_team_customer", "ai_team_owner", "ai_tools", "ai_instructions", "ai_stats",
  "ai_chat_t", "ai_chat_ph", "ai_send", "ai_thinking", "ai_pending_t", "ai_none_pending",
  "ai_apply", "ai_approve", "ai_reject", "ai_undo", "ai_st_preview", "ai_st_waiting",
  "ai_st_applied", "ai_st_rejected", "ai_st_undone", "ai_refused_t", "ai_convs_t",
  "ai_flag_off", "ai_mock_note",
];

let failed = false;
console.log(`Checking ${NEW_KEYS.length} Phase-1+2 keys across ${LOCALES.length} locales\n`);
console.log("locale        native  fallback  unresolved");
for (const { code } of LOCALES) {
  const resolved = getDictionary(code);
  const native = NATIVE_DICTS[code] ?? {};
  const unresolved = NEW_KEYS.filter((k) => typeof resolved[k] !== "string" || resolved[k] === "");
  const nativeCount = NEW_KEYS.filter((k) => typeof native[k] === "string" && native[k] !== "").length;
  const fallback = NEW_KEYS.length - nativeCount - 0; // keys served by English fallback
  console.log(
    `${code.padEnd(13)} ${String(nativeCount).padStart(5)}  ${String(fallback).padStart(7)}  ${unresolved.length}`,
  );
  if (unresolved.length > 0) {
    failed = true;
    console.error(`  ✗ ${code} cannot resolve: ${unresolved.join(", ")}`);
  }
  if ((code === "en" || code === "ar") && nativeCount !== NEW_KEYS.length) {
    failed = true;
    console.error(`  ✗ ${code} must natively define all ${NEW_KEYS.length} new keys (has ${nativeCount})`);
  }
}
console.log(
  "\nNote: locales other than en/ar (and core fr/es/de strings) resolve the new admin keys\n" +
    "via the English fallback until owner-reviewed translations are added — counted above,\n" +
    "not hidden. Admin remains fully usable in every locale.",
);
process.exit(failed ? 1 : 0);
