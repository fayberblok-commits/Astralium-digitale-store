import { cookies } from "next/headers";
import { DEFAULT_CURRENCY, isCurrency, currencyForLocale } from "./currency";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** Currency chosen by the visitor (cookie), else guessed from locale. */
export async function currentCurrency(locale: string): Promise<string> {
  const jar = await cookies();
  const chosen = jar.get("astralium-currency")?.value;
  if (chosen && isCurrency(chosen)) return chosen;
  return currencyForLocale(locale) || DEFAULT_CURRENCY;
}
