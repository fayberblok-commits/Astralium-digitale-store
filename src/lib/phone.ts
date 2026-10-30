/**
 * Phone validation + normalisation (E.164) via libphonenumber-js.
 * Used by checkout (WhatsApp delivery opt-in) and by the WhatsApp adapter.
 * Raw numbers are never logged by callers — only hashes (see lib/pii.ts).
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

export interface PhoneResult {
  ok: true;
  e164: string;
  country: string | null;
}

export function normalizePhone(input: string, defaultCountry?: string): PhoneResult | { ok: false; reason: "empty" | "invalid" } {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  try {
    const parsed = parsePhoneNumberFromString(raw, (defaultCountry || undefined) as CountryCode | undefined);
    if (!parsed || !parsed.isValid()) return { ok: false, reason: "invalid" };
    return { ok: true, e164: parsed.format("E.164"), country: parsed.country ?? null };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function isValidPhone(input: string, defaultCountry?: string): boolean {
  return normalizePhone(input, defaultCountry).ok;
}

/** Country select options for the checkout phone field (code + label). */
export const PHONE_COUNTRIES: { code: string; label: string }[] = [
  { code: "US", label: "United States (+1)" },
  { code: "GB", label: "United Kingdom (+44)" },
  { code: "MA", label: "Morocco (+212)" },
  { code: "EG", label: "Egypt (+20)" },
  { code: "SA", label: "Saudi Arabia (+966)" },
  { code: "AE", label: "UAE (+971)" },
  { code: "QA", label: "Qatar (+974)" },
  { code: "KW", label: "Kuwait (+965)" },
  { code: "DZ", label: "Algeria (+213)" },
  { code: "TN", label: "Tunisia (+216)" },
  { code: "FR", label: "France (+33)" },
  { code: "DE", label: "Germany (+49)" },
  { code: "ES", label: "Spain (+34)" },
  { code: "IT", label: "Italy (+39)" },
  { code: "NL", label: "Netherlands (+31)" },
  { code: "BE", label: "Belgium (+32)" },
  { code: "TR", label: "Türkiye (+90)" },
  { code: "IN", label: "India (+91)" },
  { code: "PK", label: "Pakistan (+92)" },
  { code: "BR", label: "Brazil (+55)" },
  { code: "MX", label: "Mexico (+52)" },
  { code: "NG", label: "Nigeria (+234)" },
  { code: "ZA", label: "South Africa (+27)" },
  { code: "AU", label: "Australia (+61)" },
];

/** Best-guess default phone country from a storefront locale. */
export function countryForLocalePhone(locale: string): string {
  const map: Record<string, string> = {
    ar: "MA", fr: "FR", es: "ES", de: "DE", it: "IT", nl: "NL", tr: "TR",
    hi: "IN", ur: "PK", pt: "BR", en: "US",
  };
  return map[locale] ?? "US";
}
