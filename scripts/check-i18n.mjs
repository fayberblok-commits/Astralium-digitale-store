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
