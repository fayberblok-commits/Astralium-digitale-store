"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LOCALES, isLocale } from "../i18n/locales";
import { CURRENCIES, isCurrency } from "../lib/currency";

export function LanguageSwitcher({ locale }: { locale: string }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <label className="switcher">
      <span className="visually-hidden">Language</span>
      <select
        aria-label="Language"
        value={locale}
        onChange={(e) => {
          const next = e.target.value;
          document.cookie = `astralium-locale=${next}; path=/; max-age=31536000`;
          const parts = (pathname || "/").split("/");
          if (parts[1] && isLocale(parts[1])) parts[1] = next;
          else parts.splice(1, 0, next);
          router.push(parts.join("/") || `/${next}`);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CurrencySwitcher({ currency }: { currency: string }) {
  const [value, setValue] = useState(currency);
  useEffect(() => {
    const saved = localStorage.getItem("astralium-currency");
    if (saved && isCurrency(saved) && saved !== currency) {
      document.cookie = `astralium-currency=${saved}; path=/; max-age=31536000`;
      setValue(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <label className="switcher">
      <span className="visually-hidden">Currency</span>
      <select
        aria-label="Currency"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          localStorage.setItem("astralium-currency", next);
          document.cookie = `astralium-currency=${next}; path=/; max-age=31536000`;
          location.reload();
        }}
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ThemeToggle({ lightLabel, darkLabel }: { lightLabel: string; darkLabel: string }) {
  const [theme, setTheme] = useState<string>("dark");
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "dark");
  }, []);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={theme === "dark" ? lightLabel : darkLabel}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("astralium-theme", next);
        setTheme(next);
      }}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
