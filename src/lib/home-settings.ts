/**
 * Homepage section layout (Phase 3 upgrade).
 *
 * The owner controls the ORDER and VISIBILITY of the homepage sections
 * from the admin panel. The layout persists server-side in the shared
 * JSON config store (DB `Setting` row `homepage_sections` when a
 * database is configured, `.data/home-sections.json` otherwise) — the
 * same mechanism as the theme and every other owner setting, so a
 * change applies storefront-wide with no rebuild and no redeploy.
 *
 * The default order is the Phase-3 brief's: cinematic hero, trust bar,
 * featured products, visual categories, bundles & offers, new releases,
 * how-it-works, guarantee, testimonials, FAQ, newsletter. `new` and
 * `guarantee` predate the brief's list; they stay first-class sections
 * (nothing removed) and the owner can hide or move them like any other.
 */
import { getJsonConfig, setJsonConfig } from "./config-store.ts";

export const HOME_SECTION_IDS = [
  "hero",
  "trust",
  "featured",
  "categories",
  "bundles",
  "new",
  "how",
  "guarantee",
  "testimonials",
  "faq",
  "newsletter",
] as const;

export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export interface HomeSectionsSettings {
  /** Full render order (every known id exactly once). */
  order: HomeSectionId[];
  /** Ids the owner has hidden from the homepage. */
  hidden: HomeSectionId[];
}

export const DEFAULT_HOME_SECTIONS: HomeSectionsSettings = {
  order: [...HOME_SECTION_IDS],
  hidden: [],
};

const SETTING_KEY = "homepage_sections";
const FILE_NAME = "home-sections.json";

function isSectionId(v: unknown): v is HomeSectionId {
  return typeof v === "string" && (HOME_SECTION_IDS as readonly string[]).includes(v);
}

/**
 * Sanitize an untrusted layout document: unknown ids are dropped,
 * duplicates collapse, and any known id missing from `order` is
 * appended in default order (so a section added by a future phase can
 * never silently vanish from the page).
 */
export function sanitizeHomeSections(raw: unknown): HomeSectionsSettings {
  if (!raw || typeof raw !== "object") return { order: [...HOME_SECTION_IDS], hidden: [] };
  const r = raw as Record<string, unknown>;
  const seen = new Set<HomeSectionId>();
  const order: HomeSectionId[] = [];
  if (Array.isArray(r.order)) {
    for (const v of r.order) {
      if (isSectionId(v) && !seen.has(v)) {
        seen.add(v);
        order.push(v);
      }
    }
  }
  for (const id of HOME_SECTION_IDS) {
    if (!seen.has(id)) order.push(id);
  }
  const hidden: HomeSectionId[] = [];
  if (Array.isArray(r.hidden)) {
    for (const v of r.hidden) {
      if (isSectionId(v) && !hidden.includes(v)) hidden.push(v);
    }
  }
  return { order, hidden };
}

/** The sections to render, in the owner's order, hidden ones removed. */
export function visibleHomeSections(settings: HomeSectionsSettings): HomeSectionId[] {
  const hidden = new Set(settings.hidden);
  return settings.order.filter((id) => !hidden.has(id));
}

export async function getHomeSections(): Promise<HomeSectionsSettings> {
  return getJsonConfig<HomeSectionsSettings>(
    SETTING_KEY,
    FILE_NAME,
    sanitizeHomeSections,
    DEFAULT_HOME_SECTIONS,
  );
}

export async function setHomeSections(
  next: Partial<HomeSectionsSettings>,
): Promise<{ persisted: "db" | "file"; value: HomeSectionsSettings }> {
  const current = await getHomeSections();
  return setJsonConfig<HomeSectionsSettings>(
    SETTING_KEY,
    FILE_NAME,
    sanitizeHomeSections({ ...current, ...next }),
    sanitizeHomeSections,
  );
}
