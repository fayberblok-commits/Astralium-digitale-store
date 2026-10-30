import Link from "next/link";
import type { LocaleCode } from "@/lib/i18n";
import { translate } from "@/lib/i18n";
import { LanguageSwitcher, CurrencySwitcher } from "@/components/prefs-controls";
import { NewsletterForm } from "@/components/newsletter-form";

export function SiteFooter({
  locale,
  currency,
  enabledLocales,
  supportEmail,
  instagram,
  x,
  linkedin,
}: {
  locale: LocaleCode;
  currency: string;
  enabledLocales: string[];
  supportEmail: string;
  instagram: string;
  x: string;
  linkedin: string;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return (
    <footer className="mt-20 border-t border-[rgba(217,178,106,0.16)] bg-[rgba(4,5,12,0.85)]">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(217,178,106,0.4)] text-[#f0dcae]">✦</span>
              <span>
                <span className="block font-display text-base tracking-[0.24em] text-[#f6f1e3]">ASTRALIUM</span>
                <span className="text-[8px] uppercase tracking-[0.4em] text-[#b8a883]">Digitale Store</span>
              </span>
            </div>
            <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-[#a09db3]">{t("tagline")}</p>
            <div className="mt-4 flex items-center gap-2">
              <a href={instagram} target="_blank" rel="noreferrer noopener" className="chip" aria-label="Instagram">
                Instagram
              </a>
              <a href={x} target="_blank" rel="noreferrer noopener" className="chip" aria-label="X">
                X
              </a>
              <a href={linkedin} target="_blank" rel="noreferrer noopener" className="chip" aria-label="LinkedIn">
                LinkedIn
              </a>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <LanguageSwitcher locale={locale} enabled={enabledLocales} compact />
              <CurrencySwitcher currency={currency} />
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-[#d9b26a]">{t("nav_catalog")}</h3>
            <ul className="space-y-2 text-[13px] text-[#b3aec1]">
              <li>
                <Link href="/catalog?category=ebook" className="hover:text-[#f0dcae]">
                  {locale === "ar" ? "كتب إلكترونية" : "Ebooks"}
                </Link>
              </li>
              <li>
                <Link href="/catalog?category=template" className="hover:text-[#f0dcae]">
                  {locale === "ar" ? "قوالب وتصاميم" : "Templates"}
                </Link>
              </li>
              <li>
                <Link href="/catalog?category=course" className="hover:text-[#f0dcae]">
                  {locale === "ar" ? "دورات" : "Courses"}
                </Link>
              </li>
              <li>
                <Link href="/catalog?category=software" className="hover:text-[#f0dcae]">
                  {locale === "ar" ? "برمجيات" : "Software"}
                </Link>
              </li>
              <li>
                <Link href="/catalog?sort=popular" className="hover:text-[#f0dcae]">
                  {t("sort_popular")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-[#d9b26a]">
              {locale === "ar" ? "المتجر" : "The house"}
            </h3>
            <ul className="space-y-2 text-[13px] text-[#b3aec1]">
              <li>
                <Link href="/about" className="hover:text-[#f0dcae]">
                  {t("nav_about")}
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-[#f0dcae]">
                  {t("nav_blog")}
                </Link>
              </li>
              <li>
                <Link href="/referral" className="hover:text-[#f0dcae]">
                  {t("nav_referral")}
                </Link>
              </li>
              <li>
                <Link href="/offers" className="hover:text-[#f0dcae]">
                  {t("nav_offers")}
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-[#f0dcae]">
                  {t("nav_contact")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-[11px] uppercase tracking-[0.28em] text-[#d9b26a]">{t("newsletter")}</h3>
            <p className="mb-3 text-[12.5px] leading-relaxed text-[#a09db3]">{t("newsletter_note")}</p>
            <NewsletterForm placeholder={t("email")} buttonLabel={t("subscribe")} />
            <div className="mt-4 space-y-1 text-[12px] text-[#a09db3]">
              <p>
                <a href={`mailto:${supportEmail}`} className="text-[#e6d6ae] hover:underline" dir="ltr">
                  {supportEmail}
                </a>
              </p>
              <p className="text-[11px] text-[#7e7a8f]">
                {locale === "ar" ? "ندعم: Visa • Mastercard • Apple Pay • Google Pay • PayPal" : "Visa • Mastercard • Apple Pay • Google Pay • PayPal"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10 h-px bg-gradient-to-r from-transparent via-[rgba(217,178,106,0.35)] to-transparent" />
        <div className="mt-5 flex flex-col gap-3 text-[11.5px] text-[#85819a] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {translate(locale, "storeName")} — {t("footer_rights")}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href="/privacy" className="hover:text-[#f0dcae]">
              {t("privacy")}
            </Link>
            <Link href="/terms" className="hover:text-[#f0dcae]">
              {t("terms")}
            </Link>
            <Link href="/refunds" className="hover:text-[#f0dcae]">
              {t("refunds")}
            </Link>
            <Link href="/support" className="hover:text-[#f0dcae]">
              {t("nav_support")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
