import type { Metadata } from "next";
import { WishlistView } from "@/components/wishlist-view";
import { getLocaleContext } from "@/lib/locale";
import { CURRENCIES } from "@/lib/money";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "قائمة الأمنيات",
  description: "احفظ المنتجات الرقمية التي تنوي شراءها لاحقًا في قائمة أمنياتك.",
};

export default async function WishlistPage() {
  const { locale, t } = await getLocaleContext();
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("nav_wishlist")}</p>
      <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{t("nav_wishlist")}</h1>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[#ada8bb]">
        {locale === "ar"
          ? "قائمتك محفوظة على هذا الجهاز. أضف ما يعجبك، وأكمل الشراء عندما تكون جاهزًا."
          : "Your list lives on this device. Save what you love and complete the purchase when ready."}
      </p>
      <div className="mt-8">
        <WishlistView locale={locale} currency={currency} labels={{ details: t("details"), remove: t("close"), empty: t("no_results") }} />
      </div>
    </div>
  );
}
