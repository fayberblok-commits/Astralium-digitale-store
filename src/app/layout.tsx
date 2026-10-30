import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { getLocale } from "@/lib/locale";
import { dirFor } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://astralium.store"),
  title: {
    default: "Astralium Digitale Store — متجر رقمي فاخر",
    template: "%s | Astralium Digitale Store",
  },
  description:
    "Astralium Digitale Store: مكتبة رقمية فاخرة للكتب الإلكترونية والصوتية، القوالب، الدورات، البرمجيات والأصول البصرية — تسليم فوري ودفع آمن بكل اللغات.",
  keywords: ["متجر رقمي", "كتب إلكترونية", "قوالب احترافية", "دورات رقمية", "Astralium", "digital store"],
  openGraph: {
    title: "Astralium Digitale Store",
    description: "معرفة فاخرة، تُسلَّم لك في لحظتها — digital goods, delivered instantly.",
    type: "website",
    siteName: "Astralium Digitale Store",
    images: ["/images/hero-nebula.jpg"],
  },
  twitter: { card: "summary_large_image", title: "Astralium Digitale Store" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#05060f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const settings = await getSettings();
  return (
    <html lang={locale} dir={dirFor(locale)} style={{ ["--accent" as string]: settings.accent, ["--accent-soft" as string]: "#f0dcae" }}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
