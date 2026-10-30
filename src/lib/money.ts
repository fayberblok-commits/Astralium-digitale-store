export type CurrencyMeta = {
  code: string;
  rate: number; // how many units of this currency per 1 USD
  symbol: string;
  decimals: number;
  labelAr: string;
  labelEn: string;
};

export const CURRENCIES: CurrencyMeta[] = [
  { code: "USD", rate: 1, symbol: "$", decimals: 2, labelAr: "دولار أمريكي", labelEn: "US Dollar" },
  { code: "EUR", rate: 0.92, symbol: "€", decimals: 2, labelAr: "يورو", labelEn: "Euro" },
  { code: "GBP", rate: 0.79, symbol: "£", decimals: 2, labelAr: "جنيه إسترليني", labelEn: "British Pound" },
  { code: "SAR", rate: 3.75, symbol: "﷼", decimals: 2, labelAr: "ريال سعودي", labelEn: "Saudi Riyal" },
  { code: "AED", rate: 3.67, symbol: "د.إ", decimals: 2, labelAr: "درهم إماراتي", labelEn: "UAE Dirham" },
  { code: "EGP", rate: 48.5, symbol: "ج.م", decimals: 2, labelAr: "جنيه مصري", labelEn: "Egyptian Pound" },
  { code: "MAD", rate: 9.9, symbol: "د.م", decimals: 2, labelAr: "درهم مغربي", labelEn: "Moroccan Dirham" },
  { code: "TRY", rate: 34.2, symbol: "₺", decimals: 2, labelAr: "ليرة تركية", labelEn: "Turkish Lira" },
  { code: "JPY", rate: 151, symbol: "¥", decimals: 0, labelAr: "ين ياباني", labelEn: "Japanese Yen" },
  { code: "CNY", rate: 7.2, symbol: "CN¥", decimals: 2, labelAr: "يوان صيني", labelEn: "Chinese Yuan" },
  { code: "INR", rate: 83.4, symbol: "₹", decimals: 0, labelAr: "روبية هندية", labelEn: "Indian Rupee" },
  { code: "RUB", rate: 92.5, symbol: "₽", decimals: 2, labelAr: "روبل روسي", labelEn: "Russian Ruble" },
  { code: "BRL", rate: 5.4, symbol: "R$", decimals: 2, labelAr: "ريال برازيلي", labelEn: "Brazilian Real" },
  { code: "CAD", rate: 1.36, symbol: "CA$", decimals: 2, labelAr: "دولار كندي", labelEn: "Canadian Dollar" },
];

export function currencyMeta(code: string): CurrencyMeta {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

/** Prices are stored in USD cents. Convert for display / charging. */
export function convertFromUsd(usdCents: number, currency: string): number {
  const meta = currencyMeta(currency);
  return Math.round(usdCents * meta.rate);
}

export function convertToUsd(amountCents: number, currency: string): number {
  const meta = currencyMeta(currency);
  return Math.round(amountCents / meta.rate);
}

export function formatAmount(cents: number, currency: string, locale = "ar"): string {
  const meta = currencyMeta(currency);
  const value = cents / 100;
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : locale, {
      style: "currency",
      currency: meta.code,
      maximumFractionDigits: meta.decimals,
      minimumFractionDigits: meta.decimals,
    }).format(value);
  } catch {
    return `${meta.symbol} ${value.toFixed(meta.decimals)}`;
  }
}

export function formatUsd(cents: number, locale = "en"): string {
  return formatAmount(cents, "USD", locale);
}

export function computeTotals({
  usdSubtotalCents,
  currency,
  discountCents,
  taxPercent,
}: {
  usdSubtotalCents: number;
  currency: string;
  discountCents: number;
  taxPercent: number;
}) {
  const convertedSubtotal = convertFromUsd(usdSubtotalCents, currency);
  const convertedDiscount = convertFromUsd(discountCents, currency);
  const taxable = Math.max(0, convertedSubtotal - convertedDiscount);
  const taxCents = Math.round((taxable * taxPercent) / 100);
  const totalCents = taxable + taxCents;
  return {
    subtotalCents: convertedSubtotal,
    discountCents: convertedDiscount,
    taxCents,
    totalCents,
    baseSubtotalCents: usdSubtotalCents,
    baseTotalCents: convertToUsd(totalCents, currency),
    fxRate: String(currencyMeta(currency).rate),
  };
}
