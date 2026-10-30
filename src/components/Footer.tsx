import Link from "next/link";
import type { Dict } from "../i18n/dictionaries";
import { LEGAL_DOCS } from "../data/legal";

export default function Footer({ locale, dict }: { locale: string; dict: Dict }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div>
          <p className="footer-brand">
            <span className="brand-line">
              <span className="brand-star">✦</span>
              <span>{dict.brand}</span>
            </span>
            <span className="brand-suffix">{dict.brandSuffix}</span>
          </p>
          <p className="muted">{dict.footer_tag}</p>
          <p className="muted">{dict.free_returns_note}</p>
        </div>
        <nav aria-label="Legal" className="footer-links">
          {LEGAL_DOCS.map((d) => (
            <Link key={d.slug} href={`/${locale}/legal/${d.slug}`}>
              {d.title}
            </Link>
          ))}
        </nav>
        <nav aria-label="Store" className="footer-links">
          <Link href={`/${locale}/shop`}>{dict.nav_shop}</Link>
          <Link href={`/${locale}/account`}>{dict.nav_account}</Link>
          <Link href={`/${locale}/cart`}>{dict.nav_cart}</Link>
        </nav>
      </div>
      <p className="footer-base">
        © {new Date().getFullYear()} Astralium Digitale Store. {dict.footer_rights}
      </p>
    </footer>
  );
}
