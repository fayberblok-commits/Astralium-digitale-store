/**
 * Storefront theme settings (Phase 2 upgrade).
 *
 * The owner's theme choice — palette, default colour mode and the
 * motion toggle for the animated homepage scene — persists
 * server-side in the shared JSON config store (DB `Setting` row when
 * a database is configured, `.data/theme.json` otherwise), exactly
 * like flags/offers/bundles. The storefront layout reads it on every
 * request and server-renders the palette tokens, so a change applies
 * storefront-wide with no rebuild and no redeploy.
 */
import { getJsonConfig, setJsonConfig } from "./config-store.ts";
import { DEFAULT_PALETTE_ID, getPalette, isPaletteId, type Palette } from "./themes.ts";

export type ThemeModePref = "light" | "dark" | "system";

export interface ThemeSettings {
  palette: string;
  /** Default colour mode for first-time visitors (their own toggle wins after). */
  mode: ThemeModePref;
  /** Animated homepage scene + gradient/button motion master switch. */
  motion: boolean;
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  palette: DEFAULT_PALETTE_ID,
  mode: "system",
  motion: true,
};

const SETTING_KEY = "storefront_theme";
const FILE_NAME = "theme.json";

export function sanitizeThemeSettings(raw: unknown): ThemeSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_THEME_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    palette: isPaletteId(r.palette) ? r.palette : DEFAULT_PALETTE_ID,
    mode: r.mode === "light" || r.mode === "dark" || r.mode === "system" ? r.mode : "system",
    motion: r.motion !== false,
  };
}

export async function getThemeSettings(): Promise<ThemeSettings> {
  return getJsonConfig<ThemeSettings>(SETTING_KEY, FILE_NAME, sanitizeThemeSettings, DEFAULT_THEME_SETTINGS);
}

export async function setThemeSettings(
  next: Partial<ThemeSettings>,
): Promise<{ persisted: "db" | "file"; value: ThemeSettings }> {
  const current = await getThemeSettings();
  return setJsonConfig<ThemeSettings>(
    SETTING_KEY,
    FILE_NAME,
    sanitizeThemeSettings({ ...current, ...next }),
    sanitizeThemeSettings,
  );
}

export async function getActivePalette(): Promise<Palette> {
  const settings = await getThemeSettings();
  return getPalette(settings.palette);
}
