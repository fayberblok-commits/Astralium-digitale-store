import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { LOCALE_CODES, isLocale, isRTL, localeInfo } from "../../i18n/locales";
import { getDictionary } from "../../i18n/dictionaries";
import { currentCurrency, siteUrl } from "../../lib/server";
import { StoreProvider } from "../../lib/store";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import CookieConsent from "../../components/CookieConsent";
import ChatWidget from "../../components/ChatWidget";
import SwRegister from "../../components/SwRegister";

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
    openGraph: { title: "Astralium Digitale Store", description: dict.hero_sub, type: "website" },
  };
}

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('astralium-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const currency = await currentCurrency(locale);
  const info = localeInfo(locale);
  return (
    <html lang={locale} dir={isRTL(locale) ? "rtl" : "ltr"} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#070a18" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script
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
          <Header locale={locale} dict={dict} currency={currency} />
          <main>{children}</main>
          <Footer locale={locale} dict={dict} />
          <CookieConsent dict={dict} />
          <ChatWidget dict={dict} locale={locale} />
          <SwRegister />
        </StoreProvider>
      </body>
    </html>
  );
}
