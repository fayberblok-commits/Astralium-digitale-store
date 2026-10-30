"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES, type LocaleCode } from "@/lib/i18n";
import { CURRENCIES } from "@/lib/money";

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function LanguageSwitcher({
  locale,
  enabled,
  compact = false,
}: {
  locale: LocaleCode;
  enabled: string[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = LOCALES.filter((item) => enabled.includes(item.code));
  return (
    <label className={`inline-flex items-center gap-1.5 ${pending ? "opacity-60" : ""}`}>
      <span className="sr-only">Language</span>
      <span aria-hidden="true" className="text-[#d9b26a]">
        ◈
      </span>
      <select
        value={locale}
        onChange={(event) => {
          setCookie("astralium_locale", event.target.value);
          startTransition(() => router.refresh());
        }}
        className={`cursor-pointer rounded-full border border-[rgba(217,178,106,0.25)] bg-[#0a0c1c] px-2.5 py-1 text-[#eeddb5] ${
          compact ? "text-[11px]" : "text-xs"
        }`}
        aria-label="Language"
      >
        {options.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CurrencySwitcher({ currency }: { currency: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className={`inline-flex items-center gap-1.5 ${pending ? "opacity-60" : ""}`}>
      <span className="sr-only">Currency</span>
      <span aria-hidden="true" className="text-[#d9b26a]">
        ⌘
      </span>
      <select
        value={currency}
        onChange={(event) => {
          setCookie("astralium_currency", event.target.value);
          startTransition(() => router.refresh());
        }}
        className="cursor-pointer rounded-full border border-[rgba(217,178,106,0.25)] bg-[#0a0c1c] px-2.5 py-1 text-[11px] text-[#eeddb5]"
        aria-label="Currency"
      >
        {CURRENCIES.map((item) => (
          <option key={item.code} value={item.code}>
            {item.code}
          </option>
        ))}
      </select>
    </label>
  );
}
