/** The 40 launch locales. `native` = the language's name in itself. */
export interface LocaleInfo {
  code: string;
  native: string;
  english: string;
  rtl: boolean;
}

export const LOCALES: LocaleInfo[] = [
  { code: "en", native: "English", english: "English", rtl: false },
  { code: "ar", native: "العربية", english: "Arabic", rtl: true },
  { code: "fr", native: "Français", english: "French", rtl: false },
  { code: "es", native: "Español", english: "Spanish", rtl: false },
  { code: "de", native: "Deutsch", english: "German", rtl: false },
  { code: "pt", native: "Português", english: "Portuguese", rtl: false },
  { code: "it", native: "Italiano", english: "Italian", rtl: false },
  { code: "nl", native: "Nederlands", english: "Dutch", rtl: false },
  { code: "ru", native: "Русский", english: "Russian", rtl: false },
  { code: "tr", native: "Türkçe", english: "Turkish", rtl: false },
  { code: "zh-Hans", native: "简体中文", english: "Chinese (Simplified)", rtl: false },
  { code: "zh-Hant", native: "繁體中文", english: "Chinese (Traditional)", rtl: false },
  { code: "ja", native: "日本語", english: "Japanese", rtl: false },
  { code: "ko", native: "한국어", english: "Korean", rtl: false },
  { code: "hi", native: "हिन्दी", english: "Hindi", rtl: false },
  { code: "bn", native: "বাংলা", english: "Bengali", rtl: false },
  { code: "ur", native: "اردو", english: "Urdu", rtl: true },
  { code: "id", native: "Bahasa Indonesia", english: "Indonesian", rtl: false },
  { code: "ms", native: "Bahasa Melayu", english: "Malay", rtl: false },
  { code: "th", native: "ไทย", english: "Thai", rtl: false },
  { code: "vi", native: "Tiếng Việt", english: "Vietnamese", rtl: false },
  { code: "tl", native: "Filipino", english: "Filipino", rtl: false },
  { code: "fa", native: "فارسی", english: "Persian", rtl: true },
  { code: "he", native: "עברית", english: "Hebrew", rtl: true },
  { code: "pl", native: "Polski", english: "Polish", rtl: false },
  { code: "uk", native: "Українська", english: "Ukrainian", rtl: false },
  { code: "cs", native: "Čeština", english: "Czech", rtl: false },
  { code: "ro", native: "Română", english: "Romanian", rtl: false },
  { code: "el", native: "Ελληνικά", english: "Greek", rtl: false },
  { code: "hu", native: "Magyar", english: "Hungarian", rtl: false },
  { code: "sv", native: "Svenska", english: "Swedish", rtl: false },
  { code: "nb", native: "Norsk bokmål", english: "Norwegian", rtl: false },
  { code: "da", native: "Dansk", english: "Danish", rtl: false },
  { code: "fi", native: "Suomi", english: "Finnish", rtl: false },
  { code: "sw", native: "Kiswahili", english: "Swahili", rtl: false },
  { code: "am", native: "አማርኛ", english: "Amharic", rtl: false },
  { code: "ha", native: "Hausa", english: "Hausa", rtl: false },
  { code: "ta", native: "தமிழ்", english: "Tamil", rtl: false },
  { code: "bg", native: "Български", english: "Bulgarian", rtl: false },
  { code: "sr", native: "Српски", english: "Serbian", rtl: false },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code);
export const DEFAULT_LOCALE = "en";

export function isLocale(code: string): boolean {
  return LOCALE_CODES.includes(code);
}

export function localeInfo(code: string): LocaleInfo {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

export function isRTL(code: string): boolean {
  return localeInfo(code).rtl;
}

/** Best match for an Accept-Language header value. */
export function matchLocale(acceptLanguage: string | null | undefined): string {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const wanted = acceptLanguage
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean);
  for (const w of wanted) {
    if (isLocale(w)) return w;
    const base = w.split("-")[0];
    // Prefer an exact script match for Chinese, otherwise base language.
    if (base === "zh") {
      return w.toLowerCase().includes("tw") || w.toLowerCase().includes("hk") || w.toLowerCase().includes("hant")
        ? "zh-Hant"
        : "zh-Hans";
    }
    const byBase = LOCALES.find((l) => l.code === base);
    if (byBase) return byBase.code;
    const regional = LOCALES.find((l) => l.code.startsWith(base + "-"));
    if (regional) return regional.code;
  }
  return DEFAULT_LOCALE;
}
