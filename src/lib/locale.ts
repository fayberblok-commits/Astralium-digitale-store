import { cookies } from "next/headers";
import { isLocale, type LocaleCode, createTranslator, dirFor, localeMeta } from "@/lib/i18n";

export const LOCALE_COOKIE = "astralium_locale";

export async function getLocale(): Promise<LocaleCode> {
  try {
    const store = await cookies();
    const value = store.get(LOCALE_COOKIE)?.value;
    if (isLocale(value)) return value;
  } catch {
    /* cookies unavailable (static rendering) */
  }
  return "ar";
}

export async function getLocaleContext() {
  const locale = await getLocale();
  return {
    locale,
    dir: dirFor(locale),
    meta: localeMeta(locale),
    t: createTranslator(locale),
  };
}

export function formatDateTime(value: Date | string | null | undefined, locale: LocaleCode = "ar"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatDate(value: Date | string | null | undefined, locale: LocaleCode = "ar"): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : locale, { dateStyle: "medium" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
