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
          <Link href={`/${locale}/privacy-center`}>{dict.pc_t}</Link>
          <Link href={`/${locale}/support`}>{dict.support_t}</Link>
        </nav>
      </div>
      {/* 2026-11 redesign: the mockups' centred payment chips + trust
          line closing the footer. Brand names are proper nouns; the
          trust line reuses the existing trust dictionary keys. */}
      <div className="footer-pay">
        <p className="pay-chips" aria-hidden="true">
          <span className="pay-chip">PayPal</span>
          <span className="pay-chip">Visa</span>
          <span className="pay-chip">Mastercard</span>
        </p>
        <p className="footer-trust">
          {dict.trust_instant} <span aria-hidden="true">•</span> {dict.trust_guarantee} <span aria-hidden="true">•</span> {dict.trust_secure}
        </p>
      </div>
      <p className="footer-base">
        © {new Date().getFullYear()} Astralium Digitale Store. {dict.footer_rights}
      </p>
    </footer>
  );
}
