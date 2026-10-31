/**
 * Design control (Phase 4 upgrade — Manager's Office, item 5).
 *
 * The office's design surface is one aggregate "design state":
 *   theme        — the Phase-2 palette/mode/motion settings
 *   homeSections — the Phase-3 homepage order/visibility layout
 *   banner       — a storefront announcement banner (new in this phase)
 *   heroText     — owner overrides for the homepage hero title/sub
 *
 * On top of the aggregate sit SAVED VERSIONS: named snapshots of the
 * whole state with one-click rollback. Rolling back first snapshots
 * the current state ("pre-rollback backup") so a rollback can itself
 * be undone — no design state is ever destroyed by restoring another.
 *
 * Each piece persists through the same JSON config store as the other
 * owner settings (DB Setting row / .data file); every setter runs the
 * piece's own sanitizer, so a corrupted snapshot can never inject bad
 * values into the storefront.
 */
import { randomUUID } from "node:crypto";
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import {
  getThemeSettings, sanitizeThemeSettings, setThemeSettings, type ThemeSettings,
} from "./theme-settings.ts";
import {
  getHomeSections, sanitizeHomeSections, setHomeSections, type HomeSectionsSettings,
} from "./home-settings.ts";

// ─── Site banner ─────────────────────────────────────────────────────────────

export interface SiteBanner {
  enabled: boolean;
  textEn: string;
  textAr: string;
  url: string;
}

export const DEFAULT_BANNER: SiteBanner = { enabled: false, textEn: "", textAr: "", url: "" };

export function sanitizeBanner(raw: unknown): SiteBanner {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<SiteBanner>;
  const url = typeof r.url === "string" ? r.url.trim().slice(0, 300) : "";
  return {
    enabled: r.enabled === true,
    textEn: typeof r.textEn === "string" ? r.textEn.slice(0, 200) : "",
    textAr: typeof r.textAr === "string" ? r.textAr.slice(0, 200) : "",
    // Only same-site paths or https links — never javascript:/data:.
    url: url.startsWith("/") || url.startsWith("https://") ? url : "",
  };
}

export async function getSiteBanner(): Promise<SiteBanner> {
  return getJsonConfig("site_banner_v1", "site-banner.json", sanitizeBanner, DEFAULT_BANNER);
}

export async function setSiteBanner(next: Partial<SiteBanner>): Promise<{ persisted: "db" | "file"; value: SiteBanner }> {
  const current = await getSiteBanner();
  return setJsonConfig("site_banner_v1", "site-banner.json", sanitizeBanner({ ...current, ...next }), sanitizeBanner);
}

/** The banner text for a storefront locale (Arabic gets textAr, everything else textEn). */
export function bannerTextFor(banner: SiteBanner, locale: string): string {
  if (!banner.enabled) return "";
  const text = locale === "ar" ? banner.textAr || banner.textEn : banner.textEn || banner.textAr;
  return text.trim();
}

// ─── Hero text override ──────────────────────────────────────────────────────

export interface HeroTextOverride {
  titleEn: string;
  titleAr: string;
  subEn: string;
  subAr: string;
}

export const EMPTY_HERO_TEXT: HeroTextOverride = { titleEn: "", titleAr: "", subEn: "", subAr: "" };

export function sanitizeHeroText(raw: unknown): HeroTextOverride {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<HeroTextOverride>;
  const pick = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    titleEn: pick(r.titleEn, 160),
    titleAr: pick(r.titleAr, 160),
    subEn: pick(r.subEn, 400),
    subAr: pick(r.subAr, 400),
  };
}

export async function getHeroText(): Promise<HeroTextOverride> {
  return getJsonConfig("hero_text_v1", "hero-text.json", sanitizeHeroText, EMPTY_HERO_TEXT);
}

export async function setHeroText(next: Partial<HeroTextOverride>): Promise<{ persisted: "db" | "file"; value: HeroTextOverride }> {
  const current = await getHeroText();
  return setJsonConfig("hero_text_v1", "hero-text.json", sanitizeHeroText({ ...current, ...next }), sanitizeHeroText);
}

/**
 * Resolve the hero copy for a page render: the owner's override wins
 * per field when non-empty; the dictionary is the fallback. (A running
 * A/B headline experiment still outranks the override — see the home
 * page, which applies the experiment first when one is live.)
 */
export function heroTextFor(
  override: HeroTextOverride,
  locale: string,
  dict: { hero_title: string; hero_sub: string },
): { title: string; sub: string } {
  const ar = locale === "ar";
  const title = (ar ? override.titleAr || override.titleEn : override.titleEn || override.titleAr).trim();
  const sub = (ar ? override.subAr || override.subEn : override.subEn || override.subAr).trim();
  return { title: title || dict.hero_title, sub: sub || dict.hero_sub };
}

// ─── Aggregate design state + versions ───────────────────────────────────────

export interface DesignState {
  theme: ThemeSettings;
  homeSections: HomeSectionsSettings;
  banner: SiteBanner;
  heroText: HeroTextOverride;
}

export function sanitizeDesignState(raw: unknown): DesignState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<DesignState>;
  return {
    theme: sanitizeThemeSettings(r.theme),
    homeSections: sanitizeHomeSections(r.homeSections),
    banner: sanitizeBanner(r.banner),
    heroText: sanitizeHeroText(r.heroText),
  };
}

export async function getDesignState(): Promise<DesignState> {
  const [theme, homeSections, banner, heroText] = await Promise.all([
    getThemeSettings(), getHomeSections(), getSiteBanner(), getHeroText(),
  ]);
  return { theme, homeSections, banner, heroText };
}

export async function applyDesignState(state: DesignState): Promise<void> {
  const clean = sanitizeDesignState(state);
  await setThemeSettings(clean.theme);
  await setHomeSections(clean.homeSections);
  await setSiteBanner(clean.banner);
  await setHeroText(clean.heroText);
}

export interface DesignVersion {
  id: string;
  name: string;
  author: string;
  createdAt: string;
  state: DesignState;
}

const MAX_VERSIONS = 20;

export function sanitizeDesignVersions(raw: unknown): DesignVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
    .map((v) => ({
      id: typeof v.id === "string" && v.id ? v.id : randomUUID(),
      name: typeof v.name === "string" && v.name.trim() ? v.name.slice(0, 80) : "Untitled version",
      author: typeof v.author === "string" ? v.author.slice(0, 120) : "",
      createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date(0).toISOString(),
      state: sanitizeDesignState(v.state),
    }))
    .slice(0, MAX_VERSIONS);
}

export async function listDesignVersions(): Promise<DesignVersion[]> {
  return getJsonConfig<DesignVersion[]>("design_versions_v1", "design-versions.json", sanitizeDesignVersions, []);
}

async function storeDesignVersions(list: DesignVersion[]): Promise<{ persisted: "db" | "file" }> {
  return setJsonConfig("design_versions_v1", "design-versions.json", sanitizeDesignVersions(list), sanitizeDesignVersions);
}

/** Snapshot the CURRENT live design state as a named version. */
export async function saveDesignVersion(name: string, author: string): Promise<{ version: DesignVersion; persisted: "db" | "file" }> {
  const state = await getDesignState();
  const version: DesignVersion = {
    id: randomUUID(),
    name: name.trim().slice(0, 80) || "Untitled version",
    author: author.slice(0, 120),
    createdAt: new Date().toISOString(),
    state,
  };
  const list = await listDesignVersions();
  const { persisted } = await storeDesignVersions([version, ...list]);
  return { version, persisted };
}

/**
 * Roll back to a saved version. The current state is snapshotted first
 * (named "Pre-rollback backup …") so the rollback is itself undoable.
 */
export async function rollbackDesignVersion(
  id: string,
  author: string,
): Promise<{ ok: boolean; error?: string; restoredName?: string }> {
  const list = await listDesignVersions();
  const target = list.find((v) => v.id === id);
  if (!target) return { ok: false, error: "VERSION_NOT_FOUND" };
  const current = await getDesignState();
  const backup: DesignVersion = {
    id: randomUUID(),
    name: `Pre-rollback backup — before “${target.name}”`,
    author: author.slice(0, 120),
    createdAt: new Date().toISOString(),
    state: current,
  };
  await storeDesignVersions([backup, ...list]);
  await applyDesignState(target.state);
  return { ok: true, restoredName: target.name };
}
