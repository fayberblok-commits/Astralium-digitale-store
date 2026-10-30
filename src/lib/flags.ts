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
