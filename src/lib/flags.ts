/**
 * Feature flags.
 *
 * Every capability added after the core store ships behind a flag. The
 * registry below holds typed defaults; when a database is configured the
 * FeatureFlag table overrides them (owner toggles in the admin panel and the
 * change persists). Messaging/money features default OFF — only email
 * delivery, the store's original channel, defaults on.
 *
 * Without a DB, getFlag() returns registry defaults and setFlag() reports
 * { persisted: false } — the admin UI states this honestly ("session
 * preview") instead of pretending the toggle was saved.
 */
import { getDb } from "./db.ts";

export interface FlagDef {
  key: string;
  defaultEnabled: boolean;
  description: string;
}

export const FLAG_REGISTRY: FlagDef[] = [
  { key: "delivery_email", defaultEnabled: true, description: "Deliver download links by email (the always-available base channel)." },
  { key: "delivery_whatsapp", defaultEnabled: false, description: "Offer WhatsApp delivery of download links (WhatsApp Business Cloud API)." },
  { key: "delivery_messenger", defaultEnabled: false, description: "Offer Facebook Messenger delivery of download links." },
  { key: "delivery_instagram", defaultEnabled: false, description: "Offer Instagram DM delivery of download links." },
  { key: "social_proof", defaultEnabled: false, description: "Real, anonymised recent-purchase strip and sales counters." },
  { key: "ai_support_v2", defaultEnabled: false, description: "Streaming LLM support assistant with order lookup." },
  { key: "subscriptions", defaultEnabled: false, description: "Membership/subscription access via Stripe Billing." },
  { key: "loyalty", defaultEnabled: false, description: "Loyalty points and reward tiers." },
  { key: "referrals", defaultEnabled: false, description: "Affiliate/referral program with commissions." },
  // Phase 3: customer library & products (features 1–8). Read-only /
  // discovery features default ON; anything that sends email or touches
  // money (order_bump, wishlist_alerts) defaults OFF.
  { key: "library", defaultEnabled: true, description: "My Library: purchases, re-downloads, version badges and update notices in the account page." },
  { key: "previews", defaultEnabled: true, description: "Free product previews served from the previews/ storage namespace (size-capped)." },
  { key: "bundles", defaultEnabled: true, description: "Owner bundles and build-your-own-bundle (any 3+ products, automatic discount)." },
  { key: "recommendations", defaultEnabled: true, description: "Explainable recommendations: also-bought, similar and top-rated rails." },
  { key: "smart_search", defaultEnabled: true, description: "Fuzzy smart search with instant suggestions (pg_trgm when a database is configured)." },
  { key: "reviews", defaultEnabled: true, description: "Verified-purchase product reviews with admin moderation." },
  { key: "order_bump", defaultEnabled: false, description: "Order bumps at checkout and one post-purchase upsell (money — owner enables explicitly)." },
  { key: "wishlist_alerts", defaultEnabled: false, description: "Wishlist price-drop alert emails (sends email — owner enables explicitly)." },
  // Phase 4: commerce expansion (features 9–16). Every money feature
  // defaults OFF; PDF receipts are a post-payment document feature and
  // default ON like the other read-only features.
  { key: "flash_sales", defaultEnabled: false, description: "Flash-sale campaigns: scheduled discounts with server-side countdown and optional quantity caps (money — owner enables explicitly)." },
  { key: "gifts", defaultEnabled: false, description: "Gift purchases: delivery to a recipient (optionally scheduled) via the delivery orchestrator; buyer gets a link-free confirmation." },
  { key: "pwyw", defaultEnabled: false, description: "Pay-what-you-want and tiered pricing on configured products, validated server-side (money — owner enables explicitly)." },
  { key: "preorders", defaultEnabled: false, description: "Pre-orders: purchasable before release; downloads stay blocked server-side until the release date." },
  { key: "express_pay", defaultEnabled: false, description: "Express checkout buttons (Apple Pay / Google Pay via Stripe, PayPal express) — rendered only when the provider is configured." },
  { key: "receipts", defaultEnabled: true, description: "PDF receipts: attached to the delivery email and downloadable from the success page and library." },
  // Phase 5: trust & content (features 17–24). Protective/read-only
  // features default ON (watermarking, license keys, fraud shield in
  // review-only mode, blog, SEO); anything that SENDS email (email
  // automation) or experiments on visitors (A/B tests) defaults OFF.
  // social_proof (feature 24) uses the pre-existing flag above — OFF.
  { key: "watermarking", defaultEnabled: true, description: "Stamp bound PDF deliverables with the buyer email + order id at download time (originals in storage are never modified)." },
  { key: "license_keys", defaultEnabled: true, description: "Issue per-order license keys for configured products, with activation limits and a public verification API." },
  { key: "fraud_shield", defaultEnabled: true, description: "Server-side checkout risk scoring: high-risk orders are HELD (delivery paused) for owner review; blacklisted emails are refused. Review-only — nothing is auto-refunded." },
  { key: "email_automation", defaultEnabled: false, description: "Automated emails: abandoned-cart recovery, post-delivery review requests and win-back — all with List-Unsubscribe (sends email — owner enables explicitly)." },
  { key: "blog", defaultEnabled: true, description: "Blog engine: owner-authored posts with a safe markdown renderer and SEO metadata." },
  { key: "seo_engine", defaultEnabled: true, description: "Dynamic sitemap (locales × pages + products + blog), robots.txt and per-product Open Graph images." },
  { key: "ab_tests", defaultEnabled: false, description: "A/B experiments on the storefront hero headline with deterministic anonymous bucketing and significance reporting." },
  // Phase 6: platform (features 25–30). ai_support_v2 upgrades the
  // pre-existing flag above (still OFF). Owner-facing infrastructure that
  // sends nothing externally defaults ON (owner_alerts in-app inbox,
  // team_access, privacy_center); anything that tracks visitors
  // (analytics) or pushes to devices (pwa_push) defaults OFF.
  { key: "owner_alerts", defaultEnabled: true, description: "Owner notification center: in-app inbox for paid orders, fraud holds, failed deliveries, pending reviews and past-due subscriptions. External channels (email digest, Telegram, WhatsApp) are key/config-gated inside the feature." },
  { key: "analytics", defaultEnabled: false, description: "Privacy-first first-party analytics: no raw IPs, no third-party trackers, consent-gated visitor id (tracks visitors — owner enables explicitly)." },
  { key: "pwa_push", defaultEnabled: false, description: "PWA install (manifest, service worker, install prompt) and Web Push notifications via VAPID keys (contacts devices — owner enables explicitly)." },
  { key: "team_access", defaultEnabled: true, description: "Team admin accounts with roles (owner/admin/support/viewer), TOTP 2FA, backup codes and an append-only audit log. The ADMIN_PASSWORD login remains the bootstrap owner." },
  { key: "privacy_center", defaultEnabled: true, description: "Public privacy center: verified data export, deletion requests with PII anonymisation, consent preferences and retention cleanup." },
];

export function flagDef(key: string): FlagDef | undefined {
  return FLAG_REGISTRY.find((f) => f.key === key);
}

/**
 * Bootstrap/test override: FLAG_<KEY>=1|0 in the environment. Consulted
 * only when no DB row exists (the DB remains the owner's source of truth),
 * so a flag can be enabled for a first boot or in automated tests without
 * a database. Unset/invalid values are ignored.
 */
export function envFlagOverride(key: string): boolean | undefined {
  const raw = process.env[`FLAG_${key.toUpperCase()}`];
  if (raw === undefined) return undefined;
  if (["1", "true", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "off"].includes(raw.toLowerCase())) return false;
  return undefined;
}

export async function getFlag(key: string): Promise<boolean> {
  const def = flagDef(key);
  if (!def) return false;
  try {
    const db = await getDb();
    if (db) {
      const row = await db.featureFlag.findUnique({ where: { key } });
      if (row) return row.enabled;
    }
  } catch {
    // DB hiccup must never break the storefront — fall through to default.
  }
  return envFlagOverride(key) ?? def.defaultEnabled;
}

export interface FlagState {
  key: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
  persisted: boolean; // backed by a DB row (or DB reachable for future writes)
}

export async function listFlags(): Promise<{ dbConfigured: boolean; flags: FlagState[] }> {
  let dbConfigured = false;
  const rows = new Map<string, boolean>();
  try {
    const db = await getDb();
    if (db) {
      dbConfigured = true;
      const all = await db.featureFlag.findMany();
      for (const r of all) rows.set(r.key, r.enabled);
    }
  } catch {
    dbConfigured = false;
  }
  return {
    dbConfigured,
    flags: FLAG_REGISTRY.map((def) => ({
      key: def.key,
      description: def.description,
      defaultEnabled: def.defaultEnabled,
      enabled: rows.has(def.key) ? rows.get(def.key)! : def.defaultEnabled,
      persisted: dbConfigured,
    })),
  };
}

export async function setFlag(
  key: string,
  enabled: boolean,
): Promise<{ ok: boolean; persisted: boolean; error?: string }> {
  const def = flagDef(key);
  if (!def) return { ok: false, persisted: false, error: "UNKNOWN_FLAG" };
  try {
    const db = await getDb();
    if (!db) return { ok: true, persisted: false };
    await db.featureFlag.upsert({
      where: { key },
      create: { key, enabled },
      update: { enabled },
    });
    return { ok: true, persisted: true };
  } catch (err) {
    return { ok: false, persisted: false, error: err instanceof Error ? err.message : "DB_WRITE_FAILED" };
  }
}
