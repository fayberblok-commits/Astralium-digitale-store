import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import "../globals.css";
// Brand typography (Phase 2 upgrade) — self-hosted via Fontsource, no
// font CDN: Playfair Display (Latin display), Amiri (Arabic display),
// Inter (Latin text), IBM Plex Sans Arabic (Arabic text).
import "@fontsource/playfair-display/500.css";
import "@fontsource/playfair-display/600.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/600-italic.css";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import { getPalette, paletteCss } from "../../lib/themes";
import { getThemeSettings } from "../../lib/theme-settings";
import { bannerTextFor, getSiteBanner } from "../../lib/design";
import { LOCALE_CODES, isLocale, isRTL, localeInfo } from "../../i18n/locales";
import { getDictionary } from "../../i18n/dictionaries";
import { currentCurrency, siteUrl } from "../../lib/server";
import { getFlag } from "../../lib/flags";
import { StoreProvider } from "../../lib/store";
import Header from "../../components/Header";
import MobileNav from "../../components/MobileNav";
import Footer from "../../components/Footer";
import CookieConsent from "../../components/CookieConsent";
import ChatWidget from "../../components/ChatWidget";
import SwRegister from "../../components/SwRegister";
import RefCapture from "../../components/RefCapture";
import AnalyticsBeacon from "../../components/AnalyticsBeacon";
import InstallPrompt from "../../components/InstallPrompt";

export function generateStaticParams() {
  return LOCALE_CODES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  const base = siteUrl();
  return {
    metadataBase: new URL(base),
    title: { default: `Astralium Digitale Store — ${dict.tagline}`, template: "%s · Astralium" },
    description: dict.hero_sub,
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALE_CODES.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      title: "Astralium Digitale Store",
      description: dict.hero_sub,
      type: "website",
      siteName: "Astralium Digitale Store",
      locale,
    },
    twitter: { card: "summary_large_image", title: "Astralium Digitale Store", description: dict.hero_sub },
  };
}

const THEME_SCRIPT = `(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('astralium-theme');if(!t){var dm=d.dataset.defaultMode;if(dm==='light'||dm==='dark'){t=dm;}else{t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}}d.dataset.theme=t;}catch(e){d.dataset.theme='dark';}})();`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // CSP nonce from the middleware (§2) — inline scripts below carry it
  // so the strict script-src admits exactly these blocks.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  const info = localeInfo(locale);
  const showBlog = await getFlag("blog");
  // Phase 4 upgrade: the owner's announcement banner (Manager's
  // Office) renders above the masthead when enabled for this locale.
  const banner = await getSiteBanner();
  const bannerText = bannerTextFor(banner, locale);
  // Phase 2 upgrade: the owner's theme choice (palette/mode/motion)
  // is read server-side and its tokens are rendered inline below, so
  // the whole store wears the active palette with no rebuild.
  const theme = await getThemeSettings();
  const palette = getPalette(theme.palette);
  // Phase 6: support v2 (streaming chat), privacy-first analytics, PWA.
  const [supportV2, analyticsOn, pwaOn] = await Promise.all([
    getFlag("ai_support_v2"),
    getFlag("analytics"),
    getFlag("pwa_push"),
  ]);
  return (
    <html
      lang={locale}
      dir={isRTL(locale) ? "rtl" : "ltr"}
      data-palette={palette.id}
      data-default-mode={theme.mode}
      data-motion={theme.motion ? "on" : "off"}
      suppressHydrationWarning
    >
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/brand/logo/logo-symbol.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content={palette.dark.bg} />
        {/* Active palette tokens (Phase 2): generated from lib/themes,
            the single source of truth — no user input is interpolated. */}
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: paletteCss(palette) }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Astralium Digitale Store",
              url: siteUrl(),
              description: dict.hero_sub,
              inLanguage: info.english,
            }),
          }}
        />
      </head>
      <body>
        <StoreProvider>
          {bannerText && (
            <div className="site-banner" role="region" aria-label={dict.office_banner_label}>
              {banner.url ? (
                <a href={banner.url} className="site-banner-link">{bannerText}</a>
              ) : (
                <span>{bannerText}</span>
              )}
            </div>
          )}
          <Header locale={locale} dict={dict} currency={currency} showBlog={showBlog} />
          <main>{children}</main>
          <Footer locale={locale} dict={dict} />
          {/* Phase 3 upgrade: thumb-reach bottom navigation, small
              screens only (CSS-gated); desktop keeps the masthead. */}
          <MobileNav locale={locale} dict={dict} />
          <CookieConsent dict={dict} />
          <ChatWidget dict={dict} locale={locale} supportV2={supportV2} />
          <SwRegister enabled={pwaOn} />
          {pwaOn && <InstallPrompt dict={dict} />}
          {analyticsOn && <AnalyticsBeacon />}
          <RefCapture />
        </StoreProvider>
      </body>
    </html>
  );
}
