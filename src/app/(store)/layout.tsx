import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getCustomerSession } from "@/lib/auth";
import { getLocaleContext } from "@/lib/locale";
import { CURRENCIES } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: { children: ReactNode }) {
  const { locale, t } = await getLocaleContext();
  const settings = await getSettings();
  const customer = await getCustomerSession();
  const cookieStore = await cookies();
  const requestedCurrency = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requestedCurrency) ? requestedCurrency : "USD";
  const announcement = locale === "ar" ? settings.announcementAr : settings.announcementEn;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        locale={locale}
        enabledLocales={settings.enabledLocales}
        announcement={announcement}
        customerName={customer?.name ?? null}
        labels={{
          home: t("nav_home"),
          catalog: t("nav_catalog"),
          agents: t("nav_agents"),
          support: t("nav_support"),
          offers: t("nav_offers"),
          blog: t("nav_blog"),
          account: t("nav_account"),
          search: t("search"),
          searchPlaceholder: t("search_placeholder"),
          menu: locale === "ar" ? "القائمة" : "Menu",
          close: t("close"),
          wishlist: t("nav_wishlist"),
        }}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter
        locale={locale}
        currency={currency}
        enabledLocales={settings.enabledLocales}
        supportEmail={settings.supportEmail}
        instagram={settings.instagram}
        x={settings.x}
        linkedin={settings.linkedin}
      />
    </div>
  );
}
