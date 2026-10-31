import Link from "next/link";
import type { Dict } from "../i18n/dictionaries";
import { LanguageSwitcher, CurrencySwitcher, ThemeToggle } from "./Switchers";
import CartLink from "./CartLink";
import Logo from "./Logo";
import NavLinks from "./NavLinks";

export default function Header({
  locale,
  dict,
  currency,
  showBlog = false,
}: {
  locale: string;
  dict: Dict;
  currency: string;
  /** Blog nav link — passed by the layout only when the blog flag is on. */
  showBlog?: boolean;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href={`/${locale}`} className="brand" aria-label={dict.brand}>
          <span className="brand-line">
            <Logo size={26} />
            <span>{dict.brand}</span>
          </span>
          <span className="brand-suffix">{dict.brandSuffix}</span>
        </Link>
        <NavLinks
          locale={locale}
          showBlog={showBlog}
          labels={{
            home: dict.nav_home,
            shop: dict.nav_shop,
            blog: dict.nav_blog,
            account: dict.nav_account,
          }}
        />
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
