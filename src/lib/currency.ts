/**
 * Multi-currency support with a static, cached FX table (USD base).
 *
 * Rates are intentionally a versioned in-repo table, refreshed by editing
 * FX_SNAPSHOT_DATE — the /api/fx route serves it with cache headers, and a
 * live-rate provider can replace `getRates()` later without touching callers.
 * The admin can also pin per-currency prices per product in a future data
 * adapter; conversion is the fallback.
 */

export interface CurrencyInfo {
  code: string;
  /** units of this currency per 1 USD */
  rate: number;
  /** suggested "smart" payment ordering note ( Stripe handles methods ) */
  label: string;
}

export const FX_SNAPSHOT_DATE = "2026-10-15";

export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", rate: 1, label: "US Dollar" },
  { code: "EUR", rate: 0.92, label: "Euro" },
  { code: "GBP", rate: 0.79, label: "British Pound" },
  { code: "AED", rate: 3.67, label: "UAE Dirham" },
  { code: "SAR", rate: 3.75, label: "Saudi Riyal" },
  { code: "MAD", rate: 9.98, label: "Moroccan Dirham" },
  { code: "EGP", rate: 48.2, label: "Egyptian Pound" },
  { code: "JPY", rate: 149.5, label: "Japanese Yen" },
  { code: "INR", rate: 83.9, label: "Indian Rupee" },
  { code: "BRL", rate: 5.62, label: "Brazilian Real" },
  { code: "TRY", rate: 34.3, label: "Turkish Lira" },
  { code: "CAD", rate: 1.36, label: "Canadian Dollar" },
  { code: "AUD", rate: 1.52, label: "Australian Dollar" },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);
export const DEFAULT_CURRENCY = "USD";

export function isCurrency(code: string): boolean {
  return CURRENCY_CODES.includes(code);
}

export function rateFor(code: string): number {
  return CURRENCIES.find((c) => c.code === code)?.rate ?? 1;
}

/** Convert a USD amount into the target currency (rounded to 2dp). */
export function convertFromUSD(amountUSD: number, currency: string): number {
  const raw = amountUSD * rateFor(currency);
  // Zero-decimal currencies round to whole units.
  if (currency === "JPY") return Math.round(raw);
  return Math.round(raw * 100) / 100;
}

export function formatPrice(amountUSD: number, currency: string, locale: string): string {
  const value = convertFromUSD(amountUSD, currency);
  try {
    return new Intl.NumberFormat(locale === "en" ? "en-US" : locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Guess a sensible default currency from a locale (manual switcher overrides). */
export function currencyForLocale(locale: string): string {
  const map: Record<string, string> = {
    ar: "AED", fr: "EUR", es: "EUR", de: "EUR", pt: "EUR", it: "EUR", nl: "EUR",
    en: "USD", ja: "JPY", hi: "INR", bn: "INR", ta: "INR", tr: "TRY",
  };
  if (locale === "en") return "USD";
  return map[locale.split("-")[0]] ?? "USD";
}

export function getRates(): { base: "USD"; snapshot: string; rates: Record<string, number> } {
  const rates: Record<string, number> = {};
  for (const c of CURRENCIES) rates[c.code] = c.rate;
  return { base: "USD", snapshot: FX_SNAPSHOT_DATE, rates };
}
