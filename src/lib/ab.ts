/**
 * A/B tests (Phase 5, feature 23). Flag `ab_tests` — default OFF.
 *
 * Experiments are defined by the owner in admin and stored via the
 * config-store pattern. The one designated slot is the homepage hero
 * headline (`hero_title`): a variant may carry a literal replacement
 * headline; the control variant (empty headline) keeps the dictionary
 * text.
 *
 * Bucketing is DETERMINISTIC and anonymous: the visitor carries only a
 * random `astralium-vid` cookie (set client-side when the flag is on);
 * the variant is sha256(experimentId:visitorId) mod 10000 mapped over
 * the traffic split — the same visitor always lands in the same variant
 * for a given experiment, and no identifier is stored server-side
 * (events keep only a HASH of the visitor id, for exposure de-dupes).
 *
 * Results: exposures/conversions per variant with a two-proportion
 * z-test against control (pure function, unit-tested math).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDb } from "./db.ts";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";

export const AB_VISITOR_COOKIE = "astralium-vid";
export const AB_SLOT_HERO = "hero_title";

export interface AbVariant {
  key: string;
  weight: number; // percent 0..100 across variants (validated to sum 100)
  headline: string; // literal replacement for the slot; "" = default copy
}

export interface AbExperiment {
  id: string;
  name: string;
  slot: string;
  status: "draft" | "running" | "stopped";
  variants: AbVariant[];
  createdAt: string;
}

export interface AbConfig {
  experiments: AbExperiment[];
}

export const EMPTY_AB_CONFIG: AbConfig = { experiments: [] };

function sanitizeVariant(raw: unknown): AbVariant | null {
  const r = (raw ?? {}) as Partial<AbVariant>;
  const key = typeof r.key === "string" ? r.key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") : "";
  if (!key) return null;
  const weight = Math.floor(Number(r.weight));
  return {
    key: key.slice(0, 40),
    weight: Number.isFinite(weight) ? Math.min(100, Math.max(0, weight)) : 0,
    headline: typeof r.headline === "string" ? r.headline.slice(0, 200) : "",
  };
}

export function sanitizeAbConfig(raw: unknown): AbConfig {
  const r = (raw ?? {}) as Partial<AbConfig>;
  if (!Array.isArray(r.experiments)) return { experiments: [] };
  const experiments: AbExperiment[] = [];
  for (const item of r.experiments) {
    const e = (item ?? {}) as Partial<AbExperiment>;
    const id = typeof e.id === "string" ? e.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60) : "";
    if (!id || experiments.some((x) => x.id === id)) continue;
    const variants = (Array.isArray(e.variants) ? e.variants : [])
      .map(sanitizeVariant)
      .filter((v): v is AbVariant => v !== null);
    if (variants.length < 2) continue;
    // Normalise weights to sum exactly 100 (last variant absorbs drift).
    const sum = variants.reduce((s, v) => s + v.weight, 0);
    if (sum <= 0) continue;
    let acc = 0;
    variants.forEach((v, i) => {
      if (i < variants.length - 1) {
        v.weight = Math.round((v.weight / sum) * 100);
        acc += v.weight;
      } else {
        v.weight = 100 - acc;
      }
    });
    experiments.push({
      id,
      name: typeof e.name === "string" ? e.name.slice(0, 120) : id,
      slot: typeof e.slot === "string" && e.slot ? e.slot : AB_SLOT_HERO,
      status: e.status === "running" || e.status === "stopped" ? e.status : "draft",
      variants,
      createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString(),
    });
  }
  return { experiments };
}

export async function getAbConfig(): Promise<AbConfig> {
  return getJsonConfig("ab_experiments", "ab-experiments.json", sanitizeAbConfig, EMPTY_AB_CONFIG);
}

export async function setAbConfig(value: AbConfig): Promise<{ persisted: "db" | "file"; value: AbConfig }> {
  return setJsonConfig("ab_experiments", "ab-experiments.json", value, sanitizeAbConfig);
}

export function runningExperimentForSlot(config: AbConfig, slot: string): AbExperiment | null {
  return config.experiments.find((e) => e.status === "running" && e.slot === slot) ?? null;
}

// ─── Deterministic bucketing (pure) ──────────────────────────────────────────

/** Stable bucket in [0, 10000) for (experiment, visitor). */
export function bucketFor(experimentId: string, visitorId: string): number {
  const h = createHash("sha256").update(`${experimentId}:${visitorId}`).digest();
  return h.readUInt32BE(0) % 10000;
}

export function assignVariant(exp: AbExperiment, visitorId: string): AbVariant {
  const bucket = bucketFor(exp.id, visitorId);
  let acc = 0;
  for (const v of exp.variants) {
    acc += v.weight * 100;
    if (bucket < acc) return v;
  }
  return exp.variants[exp.variants.length - 1];
}

/** Headline for the hero slot: variant copy, or null → dictionary default. */
export function heroHeadlineFor(exp: AbExperiment | null, visitorId: string | null): string | null {
  if (!exp || !visitorId) return null;
  const variant = assignVariant(exp, visitorId);
  return variant.headline ? variant.headline : null;
}

// ─── Events & statistics ─────────────────────────────────────────────────────

export interface AbEventRecord {
  experimentId: string;
  variantKey: string;
  type: "exposure" | "conversion";
  visitorHash: string;
  createdAt: string;
}

const EVENTS_PATH = path.join(process.cwd(), ".data", "ab-events.json");

async function readEvents(): Promise<AbEventRecord[]> {
  try {
    return JSON.parse(await fs.readFile(EVENTS_PATH, "utf8")) as AbEventRecord[];
  } catch {
    return [];
  }
}

async function writeEvents(list: AbEventRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(EVENTS_PATH), { recursive: true });
  await fs.writeFile(EVENTS_PATH, JSON.stringify(list, null, 2), "utf8");
}

export function hashVisitor(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex");
}

/**
 * Record an event. Exposures de-duplicate per (experiment, variant,
 * visitor): a refresh never inflates the denominator. Conversions are
 * recorded per event (a visitor converts at most once in practice — the
 * success page fires once per order thanks to the same de-dupe key).
 */
export async function recordAbEvent(input: {
  experimentId: string;
  variantKey: string;
  type: "exposure" | "conversion";
  visitorId: string;
}): Promise<{ recorded: boolean }> {
  const visitorHash = hashVisitor(input.visitorId);
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const dupe = await db.abEvent.findFirst({
        where: { experimentId: input.experimentId, variantKey: input.variantKey, type: input.type, visitorHash },
      });
      if (dupe) return { recorded: false };
      await db.abEvent.create({
        data: { experimentId: input.experimentId, variantKey: input.variantKey, type: input.type, visitorHash },
      });
      return { recorded: true };
    } catch { /* fall through */ }
  }
  const all = await readEvents();
  const dupe = all.some(
    (e) => e.experimentId === input.experimentId && e.variantKey === input.variantKey &&
      e.type === input.type && e.visitorHash === visitorHash,
  );
  if (dupe) return { recorded: false };
  all.push({
    experimentId: input.experimentId, variantKey: input.variantKey, type: input.type,
    visitorHash, createdAt: new Date().toISOString(),
  });
  await writeEvents(all);
  return { recorded: true };
}

export async function listAbEvents(experimentId: string): Promise<AbEventRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.abEvent.findMany({ where: { experimentId }, take: 100_000 });
      if (rows.length > 0) {
        return rows.map((r) => ({
          experimentId: r.experimentId, variantKey: r.variantKey,
          type: r.type === "conversion" ? "conversion" : "exposure",
          visitorHash: r.visitorHash, createdAt: r.createdAt.toISOString(),
        }));
      }
    } catch { /* fall through */ }
  }
  return (await readEvents()).filter((e) => e.experimentId === experimentId);
}

// ─── Statistics (pure) ───────────────────────────────────────────────────────

/** Standard normal CDF via the Abramowitz–Stegun erf approximation. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI) * poly;
  return z >= 0 ? p : 1 - p;
}

export interface ZTestResult {
  z: number;
  pValue: number; // two-sided
  significant95: boolean;
}

/** Two-proportion z-test: variant (x2/n2) vs control (x1/n1). */
export function twoProportionZTest(x1: number, n1: number, x2: number, n2: number): ZTestResult {
  if (n1 <= 0 || n2 <= 0) return { z: 0, pValue: 1, significant95: false };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, pValue: 1, significant95: false };
  const z = (p2 - p1) / se;
  const pValue = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  return { z, pValue, significant95: pValue < 0.05 };
}

export interface VariantResult {
  key: string;
  exposures: number;
  conversions: number;
  rate: number;
  vsControl: ZTestResult | null; // null for the control variant itself
}

export interface ExperimentResults {
  experimentId: string;
  variants: VariantResult[];
}

export function computeResults(exp: AbExperiment, events: AbEventRecord[]): ExperimentResults {
  const counts = new Map<string, { exposures: number; conversions: number }>();
  for (const v of exp.variants) counts.set(v.key, { exposures: 0, conversions: 0 });
  for (const e of events) {
    if (e.experimentId !== exp.id) continue;
    const c = counts.get(e.variantKey);
    if (!c) continue;
    if (e.type === "exposure") c.exposures++;
    else c.conversions++;
  }
  const controlKey = exp.variants[0]?.key;
  const control = controlKey ? counts.get(controlKey) : undefined;
  const variants: VariantResult[] = exp.variants.map((v) => {
    const c = counts.get(v.key)!;
    return {
      key: v.key,
      exposures: c.exposures,
      conversions: c.conversions,
      rate: c.exposures > 0 ? c.conversions / c.exposures : 0,
      vsControl:
        v.key === controlKey || !control
          ? null
          : twoProportionZTest(control.conversions, control.exposures, c.conversions, c.exposures),
    };
  });
  return { experimentId: exp.id, variants };
}
