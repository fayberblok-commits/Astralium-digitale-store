/**
 * AI gateway configuration (Phase 5 upgrade).
 *
 * Two layers, per the owner's rule "provider and model are set by
 * environment variables AND the admin panel":
 *  - ENV provides the SECRETS and defaults: MODEL_API_KEY (Meta Model
 *    API), AI_META_MODEL (default "muse-spark-1.3"), AI_META_BASE_URL
 *    (default https://api.meta.ai/v1 — Meta's verified endpoint),
 *    AI_FALLBACK_API_KEY / AI_FALLBACK_BASE_URL / AI_FALLBACK_MODEL
 *    for the generic OpenAI-compatible fallback (the legacy
 *    OPENAI_API_KEY / OPENAI_MODEL pair is honoured as that fallback),
 *    AI_PROVIDER=mock for the deterministic test double, and the cap
 *    defaults AI_DAILY_COST_CAP_USD / AI_DAILY_ACTION_CAP.
 *  - The OFFICE stores the operational choices (config store, DB
 *    Setting `ai_gateway_v1` / `.data/ai-gateway.json`): which
 *    provider is ACTIVE (the one-click switch), whether the fallback
 *    may take over on a primary error, model overrides, the caps and
 *    the EMERGENCY STOP.
 *
 * Keys are NEVER read from the settings document and NEVER returned
 * by getAiStatus() — the office sees configured/not-configured only.
 */
import { getJsonConfig, setJsonConfig } from "../config-store.ts";
import { createOpenAiCompatibleProvider } from "./openai-compatible.ts";
import { createMockProvider } from "./mock.ts";
import type { AiProvider } from "./types.ts";

export type AiProviderId = "meta" | "openai";

export interface AiGatewaySettings {
  activeProvider: AiProviderId;
  fallbackEnabled: boolean;
  metaModel: string;
  fallbackModel: string;
  dailyCostCapUSD: number;
  dailyActionCap: number;
  emergencyStop: boolean;
}

const envNum = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

export const DEFAULT_AI_SETTINGS: AiGatewaySettings = {
  activeProvider: "meta",
  fallbackEnabled: true,
  metaModel: "muse-spark-1.3",
  fallbackModel: "",
  dailyCostCapUSD: envNum("AI_DAILY_COST_CAP_USD", 5),
  dailyActionCap: Math.floor(envNum("AI_DAILY_ACTION_CAP", 50)),
  emergencyStop: false,
};

export function sanitizeAiSettings(raw: unknown): AiGatewaySettings {
  const out: AiGatewaySettings = { ...DEFAULT_AI_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<AiGatewaySettings>;
  if (r.activeProvider === "meta" || r.activeProvider === "openai") out.activeProvider = r.activeProvider;
  if (typeof r.fallbackEnabled === "boolean") out.fallbackEnabled = r.fallbackEnabled;
  if (typeof r.metaModel === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(r.metaModel.trim())) out.metaModel = r.metaModel.trim();
  if (typeof r.fallbackModel === "string" && r.fallbackModel.length <= 80) out.fallbackModel = r.fallbackModel.trim();
  if (typeof r.dailyCostCapUSD === "number" && Number.isFinite(r.dailyCostCapUSD) && r.dailyCostCapUSD >= 0) {
    out.dailyCostCapUSD = Math.min(10_000, r.dailyCostCapUSD);
  }
  if (typeof r.dailyActionCap === "number" && Number.isFinite(r.dailyActionCap) && r.dailyActionCap >= 0) {
    out.dailyActionCap = Math.min(10_000, Math.floor(r.dailyActionCap));
  }
  if (typeof r.emergencyStop === "boolean") out.emergencyStop = r.emergencyStop;
  return out;
}

export async function getAiSettings(): Promise<AiGatewaySettings> {
  return getJsonConfig<AiGatewaySettings>("ai_gateway_v1", "ai-gateway.json", sanitizeAiSettings, { ...DEFAULT_AI_SETTINGS });
}

export async function setAiSettings(next: Partial<AiGatewaySettings>): Promise<{ persisted: "db" | "file"; value: AiGatewaySettings }> {
  const current = await getAiSettings();
  return setJsonConfig("ai_gateway_v1", "ai-gateway.json", { ...current, ...next }, sanitizeAiSettings);
}

// ─── Provider construction (env secrets only) ────────────────────────────────

export function metaKeyPresent(): boolean {
  return Boolean(process.env.MODEL_API_KEY && process.env.MODEL_API_KEY.trim().length > 0);
}

export function fallbackKeyPresent(): boolean {
  return Boolean(
    (process.env.AI_FALLBACK_API_KEY && process.env.AI_FALLBACK_API_KEY.trim()) ||
    (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()),
  );
}

export function fallbackModelId(settings: AiGatewaySettings): string {
  return settings.fallbackModel || process.env.AI_FALLBACK_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export async function buildProvider(id: AiProviderId | "mock"): Promise<AiProvider | null> {
  const settings = await getAiSettings();
  if (id === "mock") return createMockProvider();
  if (id === "meta") {
    if (!metaKeyPresent()) return null;
    return createOpenAiCompatibleProvider({
      id: "meta",
      baseUrl: process.env.AI_META_BASE_URL || "https://api.meta.ai/v1",
      apiKey: process.env.MODEL_API_KEY!,
      model: settings.metaModel || process.env.AI_META_MODEL || "muse-spark-1.3",
    });
  }
  if (!fallbackKeyPresent()) return null;
  return createOpenAiCompatibleProvider({
    id: "openai-compatible",
    baseUrl: process.env.AI_FALLBACK_BASE_URL || "https://api.openai.com/v1",
    apiKey: (process.env.AI_FALLBACK_API_KEY || process.env.OPENAI_API_KEY)!,
    model: fallbackModelId(settings),
  });
}

export interface AiStatus {
  /** True when the ACTIVE provider can actually be called. */
  configured: boolean;
  /** "meta" | "openai" | "mock" | null (nothing configured) */
  active: string | null;
  activeModel: string | null;
  mockMode: boolean;
  emergencyStop: boolean;
  fallbackEnabled: boolean;
  providers: { id: string; configured: boolean; model: string }[];
  caps: { dailyCostCapUSD: number; dailyActionCap: number };
  settings: AiGatewaySettings;
}

/** Office-safe status: booleans and model ids only — never key material. */
export async function getAiStatus(): Promise<AiStatus> {
  const settings = await getAiSettings();
  const mockMode = process.env.AI_PROVIDER === "mock";
  const providers = [
    { id: "meta", configured: metaKeyPresent(), model: settings.metaModel },
    { id: "openai", configured: fallbackKeyPresent(), model: fallbackModelId(settings) },
  ];
  if (mockMode) {
    return {
      configured: true, active: "mock", activeModel: "mock-1", mockMode,
      emergencyStop: settings.emergencyStop, fallbackEnabled: settings.fallbackEnabled,
      providers, caps: { dailyCostCapUSD: settings.dailyCostCapUSD, dailyActionCap: settings.dailyActionCap },
      settings,
    };
  }
  const activeDef = providers.find((p) => p.id === settings.activeProvider);
  return {
    configured: Boolean(activeDef?.configured),
    active: activeDef?.configured ? settings.activeProvider : null,
    activeModel: activeDef?.configured ? activeDef.model : null,
    mockMode,
    emergencyStop: settings.emergencyStop,
    fallbackEnabled: settings.fallbackEnabled,
    providers,
    caps: { dailyCostCapUSD: settings.dailyCostCapUSD, dailyActionCap: settings.dailyActionCap },
    settings,
  };
}

/**
 * Resolve the provider for a turn: the office-selected active
 * provider (or the mock in mock mode). Returns null when the active
 * provider has no key configured — callers degrade honestly.
 */
export async function resolveActiveProvider(): Promise<AiProvider | null> {
  if (process.env.AI_PROVIDER === "mock") return buildProvider("mock");
  const settings = await getAiSettings();
  return buildProvider(settings.activeProvider);
}

/** The OTHER real provider, when fallback is enabled + configured. */
export async function resolveFallbackProvider(): Promise<AiProvider | null> {
  if (process.env.AI_PROVIDER === "mock") return null;
  const settings = await getAiSettings();
  if (!settings.fallbackEnabled) return null;
  const other: AiProviderId = settings.activeProvider === "meta" ? "openai" : "meta";
  return buildProvider(other);
}
