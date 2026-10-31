/**
 * AI usage ledger + caps (Phase 5 upgrade).
 *
 * One JSON document (config store: DB Setting `ai_usage_v1`, else
 * `.data/ai-usage.json`) holding per-day counters: token usage, the
 * estimated USD cost (published list prices — see types.ts), the
 * number of owner-staff ACTIONS proposed, and conversation counts.
 * The gateway consults the caps BEFORE spending: a reached daily cost
 * cap stops model calls (customer side falls back to the grounded
 * engine; owner side refuses the turn) and a reached action cap stops
 * new action proposals. Nothing here ever blocks the store itself.
 */
import { getJsonConfig, setJsonConfig } from "../config-store.ts";
import { estimateCostUSD, type AiUsage } from "./types.ts";

export interface AiDayUsage {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  actions: number;
  conversations: number;
  turns: number;
}

interface UsageDoc {
  days: Record<string, AiDayUsage>;
}

const EMPTY_DAY: AiDayUsage = { inputTokens: 0, outputTokens: 0, costUSD: 0, actions: 0, conversations: 0, turns: 0 };

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function sanitizeUsageDoc(raw: unknown): UsageDoc {
  const out: UsageDoc = { days: {} };
  if (!raw || typeof raw !== "object") return out;
  const days = (raw as { days?: unknown }).days;
  if (!days || typeof days !== "object") return out;
  for (const [day, v] of Object.entries(days as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !v || typeof v !== "object") continue;
    const r = v as Partial<AiDayUsage>;
    const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
    out.days[day] = {
      inputTokens: num(r.inputTokens), outputTokens: num(r.outputTokens),
      costUSD: Math.round(num(r.costUSD) * 1e6) / 1e6,
      actions: Math.floor(num(r.actions)), conversations: Math.floor(num(r.conversations)),
      turns: Math.floor(num(r.turns)),
    };
  }
  // Keep the last 31 days only — the ledger is a cap counter, not an archive.
  const keys = Object.keys(out.days).sort().slice(-31);
  out.days = Object.fromEntries(keys.map((k) => [k, out.days[k]]));
  return out;
}

export async function getUsageDoc(): Promise<UsageDoc> {
  return getJsonConfig<UsageDoc>("ai_usage_v1", "ai-usage.json", sanitizeUsageDoc, { days: {} });
}

export async function getTodayUsage(): Promise<AiDayUsage> {
  const doc = await getUsageDoc();
  return doc.days[todayKey()] ?? { ...EMPTY_DAY };
}

export async function recordAiUsage(input: {
  usage?: AiUsage;
  model?: string;
  actions?: number;
  conversation?: boolean;
  turn?: boolean;
}): Promise<AiDayUsage> {
  const doc = await getUsageDoc();
  const key = todayKey();
  const day: AiDayUsage = doc.days[key] ?? { ...EMPTY_DAY };
  if (input.usage) {
    day.inputTokens += Math.max(0, Math.floor(input.usage.inputTokens));
    day.outputTokens += Math.max(0, Math.floor(input.usage.outputTokens));
    day.costUSD = Math.round((day.costUSD + estimateCostUSD(input.model ?? "", input.usage)) * 1e6) / 1e6;
  }
  if (input.actions) day.actions += input.actions;
  if (input.conversation) day.conversations += 1;
  if (input.turn) day.turns += 1;
  doc.days[key] = day;
  const saved = await setJsonConfig("ai_usage_v1", "ai-usage.json", doc, sanitizeUsageDoc);
  return saved.value.days[key] ?? day;
}

export interface CapStatus {
  today: AiDayUsage;
  costCapUSD: number;
  actionCap: number;
  costOk: boolean;
  actionsOk: boolean;
}

export async function checkCaps(caps: { dailyCostCapUSD: number; dailyActionCap: number }): Promise<CapStatus> {
  const today = await getTodayUsage();
  return {
    today,
    costCapUSD: caps.dailyCostCapUSD,
    actionCap: caps.dailyActionCap,
    costOk: caps.dailyCostCapUSD <= 0 || today.costUSD < caps.dailyCostCapUSD,
    actionsOk: caps.dailyActionCap <= 0 || today.actions < caps.dailyActionCap,
  };
}
