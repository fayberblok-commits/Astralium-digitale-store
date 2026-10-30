import Link from "next/link";
import type { Dict } from "../i18n/dictionaries";
import { LanguageSwitcher, CurrencySwitcher, ThemeToggle } from "./Switchers";
import CartLink from "./CartLink";

export default function Header({
  locale,
  dict,
  currency,
}: {
  locale: string;
  dict: Dict;
  currency: string;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href={`/${locale}`} className="brand" aria-label={dict.brand}>
          <span className="brand-line">
            <span className="brand-star">✦</span>
            <span>{dict.brand}</span>
          </span>
          <span className="brand-suffix">{dict.brandSuffix}</span>
        </Link>
        <nav className="main-nav" aria-label="Main">
          <Link href={`/${locale}`}>{dict.nav_home}</Link>
          <Link href={`/${locale}/shop`}>{dict.nav_shop}</Link>
          <Link href={`/${locale}/account`}>{dict.nav_account}</Link>
        </nav>
        <div className="header-actions">
          <LanguageSwitcher locale={locale} />
          <CurrencySwitcher currency={currency} />
          <ThemeToggle lightLabel={dict.theme_light} darkLabel={dict.theme_dark} />
          <CartLink locale={locale} label={dict.nav_cart} />
        </div>
      </div>
    </header>
  );
}
