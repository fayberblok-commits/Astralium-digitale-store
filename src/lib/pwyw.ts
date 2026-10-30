/**
 * Pay-what-you-want + tiered pricing (Phase 4, feature 13).
 *
 * Per-product owner configuration (Setting "pwyw_config" / .data/pwyw.json):
 *   { [productId]: { minUSD, suggestedUSD, tiers: [{priceUSD, label, bonus}] } }
 *
 * Money safety: the amount charged is resolved HERE, server-side, from
 * the stored config. The client may propose a custom amount or pick a
 * tier index; both are validated — a custom amount below minUSD is
 * rejected, and a tier's price is read from the config, never from the
 * request. Tier bonuses are descriptive text (what the buyer gets
 * extra); the tier only changes the price, server-side.
 */
import { getProductById, type Product } from "../data/products.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { round2 } from "./byo.ts";

export interface PwywTier {
  priceUSD: number;
  label: string;
  bonus: string;
}

export interface PwywProductConfig {
  minUSD: number;
  suggestedUSD: number;
  tiers: PwywTier[];
}

export type PwywConfig = Record<string, PwywProductConfig>;

const SETTING_KEY = "pwyw_config";
const FILE = "pwyw.json";

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

export function sanitizePwywConfig(raw: unknown): PwywConfig {
  if (!raw || typeof raw !== "object") return {};
  const out: PwywConfig = {};
  for (const [pid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!getProductById(pid) || !v || typeof v !== "object") continue;
    const c = v as { minUSD?: unknown; suggestedUSD?: unknown; tiers?: unknown };
    const minUSD = money(c.minUSD);
    if (minUSD <= 0) continue;
    const tiers: PwywTier[] = [];
    if (Array.isArray(c.tiers)) {
      for (const t of c.tiers.slice(0, 6)) {
        if (!t || typeof t !== "object") continue;
        const tier = t as { priceUSD?: unknown; label?: unknown; bonus?: unknown };
        const priceUSD = money(tier.priceUSD);
        if (priceUSD < minUSD) continue; // a tier can never undercut the floor
        tiers.push({
          priceUSD,
          label: String(tier.label ?? "").slice(0, 60),
          bonus: String(tier.bonus ?? "").slice(0, 160),
        });
      }
    }
    out[pid] = {
      minUSD,
      suggestedUSD: Math.max(minUSD, money(c.suggestedUSD) || minUSD),
      tiers: tiers.sort((a, b) => a.priceUSD - b.priceUSD),
    };
  }
  return out;
}

export async function getPwywConfig(): Promise<PwywConfig> {
  return getJsonConfig<PwywConfig>(SETTING_KEY, FILE, sanitizePwywConfig, {});
}

export async function setPwywConfig(config: PwywConfig): Promise<{ persisted: "db" | "file"; value: PwywConfig }> {
  return setJsonConfig(SETTING_KEY, FILE, config, sanitizePwywConfig);
}

export type PwywChoice = { amountUSD?: number; tierIndex?: number };

export type PwywResolution =
  | { ok: true; priceUSD: number; source: "custom" | "tier"; tier?: PwywTier }
  | { ok: false; error: "PWYW_NOT_CONFIGURED" | "BELOW_MIN" | "INVALID_TIER" | "INVALID_AMOUNT" };

/** Resolve the server-side price for a PWYW product (pure). */
export function resolvePwywPrice(
  config: PwywConfig,
  product: Product,
  choice: PwywChoice,
): PwywResolution {
  const cfg = config[product.id];
  if (!cfg) return { ok: false, error: "PWYW_NOT_CONFIGURED" };
  if (choice.tierIndex !== undefined) {
    const tier = cfg.tiers[choice.tierIndex];
    if (!tier) return { ok: false, error: "INVALID_TIER" };
    return { ok: true, priceUSD: tier.priceUSD, source: "tier", tier };
  }
  const amount = Number(choice.amountUSD);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "INVALID_AMOUNT" };
  const priceUSD = round2(amount);
  if (priceUSD < cfg.minUSD) return { ok: false, error: "BELOW_MIN" };
  return { ok: true, priceUSD, source: "custom" };
}
