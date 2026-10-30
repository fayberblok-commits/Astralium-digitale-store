import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ProductCard, Alert, EmptyState } from "@/components/ui";
import { getLocaleContext } from "@/lib/locale";
import { CATEGORIES, categoryLabel } from "@/lib/i18n";
import { CURRENCIES, convertFromUsd, formatAmount } from "@/lib/money";
import { getCategoryCounts, listProducts, findCoupon } from "@/lib/store";

export const metadata: Metadata = {
  title: "كل ما هو رقمي — المكتبة الكاملة",
  description: "استعرض كل المنتجات الرقمية: كتب، صوتيات، قوالب، دورات، برمجيات وأصول بصرية، مع بحث وتصنيفات وترتيب.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { locale, t } = await getLocaleContext();
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";

  const q = single(params.q);
  const category = single(params.category) || "all";
  const sort = (single(params.sort) || "newest") as "newest" | "price_asc" | "price_desc" | "popular" | "rating";
  const page = Math.max(1, Number(single(params.page)) || 1);
  const min = Number(single(params.min));
  const max = Number(single(params.max));
  const couponCode = single(params.coupon);

  const [{ items, total, perPage }, counts, coupon] = await Promise.all([
    listProducts({
      q,
      category,
      sort,
      page,
      perPage: 9,
      minUsd: Number.isFinite(min) && min > 0 ? min : undefined,
      maxUsd: Number.isFinite(max) && max > 0 ? max : undefined,
    }),
    getCategoryCounts(),
    couponCode ? findCoupon(couponCode) : Promise.resolve(null),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const baseParams = new URLSearchParams();
  if (q) baseParams.set("q", q);
  if (category !== "all") baseParams.set("category", category);
  if (sort !== "newest") baseParams.set("sort", sort);
  if (min > 0) baseParams.set("min", String(min));
  if (max > 0) baseParams.set("max", String(max));
  const buildPage = (target: number) => {
    const next = new URLSearchParams(baseParams);
    next.set("page", String(target));
    return `/catalog?${next.toString()}`;
  };
  const categoryOptions = CATEGORIES.filter((item) => (counts[item.value] ?? 0) > 0 || item.value === "bundle");

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-[11px] text-[#8f8ba2]">
        <Link href="/" className="hover:text-[#f0dcae]">
          {t("nav_home")}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[#d8c8a2]">{t("nav_catalog")}</span>
      </nav>

      <div className="glass mb-6 rounded-2xl p-5 sm:p-7">
        <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("browse")}</p>
        <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{t("nav_catalog")}</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[#ada8bb]">
          {locale === "ar"
            ? "مكتبة رقمية واحدة تجمع المعرفة والأدوات والأصول الجاهزة. استخدم البحث والفلاتر للوصول إلى ما تحتاجه خلال ثوانٍ."
            : "One digital library for knowledge, tools and ready assets. Use search and filters to reach exactly what you need."}
        </p>
        {coupon ? (
          <div className="mt-4">
            <Alert tone="success">
              {locale === "ar" ? "كوبون جاهز للتطبيق:" : "Coupon ready to apply:"}{" "}
              <span className="font-mono text-[#f0dcae]">{coupon.code}</span> —{" "}
              {coupon.kind === "percent" ? `${coupon.value}%` : formatAmount(convertFromUsd(coupon.value, currency), currency, locale)}{" "}
              {locale === "ar" ? "عند إتمام الشراء." : "off at checkout."}
            </Alert>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
        <aside className="space-y-4">
          <form action="/catalog" className="glass rounded-2xl p-4">
            <label htmlFor="catalog-q" className="mb-2 block text-[11px] uppercase tracking-[0.2em] text-[#b3a98f]">
              {t("search")}
            </label>
            <input id="catalog-q" name="q" defaultValue={q} placeholder={t("search_placeholder")} className="field text-[12.5px]" />
            <label htmlFor="catalog-min" className="mb-1 mt-3 block text-[11px] uppercase tracking-[0.2em] text-[#b3a98f]">
              {t("filters")} (USD)
            </label>
            <div className="flex items-center gap-2">
              <input id="catalog-min" name="min" type="number" min="0" step="1" defaultValue={min > 0 ? min : ""} placeholder="0" className="field text-[12px]" />
              <span className="text-[#8f8ba2]">—</span>
              <input name="max" type="number" min="0" step="1" defaultValue={max > 0 ? max : ""} placeholder="199" aria-label="Max price" className="field text-[12px]" />
            </div>
            <label htmlFor="catalog-sort" className="mb-1 mt-3 block text-[11px] uppercase tracking-[0.2em] text-[#b3a98f]">
              {t("sort")}
            </label>
            <select id="catalog-sort" name="sort" defaultValue={sort} className="field text-[12.5px]">
              <option value="newest">{t("sort_newest")}</option>
              <option value="popular">{t("sort_popular")}</option>
              <option value="rating">{t("sort_rating")}</option>
              <option value="price_asc">{t("sort_price_asc")}</option>
              <option value="price_desc">{t("sort_price_desc")}</option>
            </select>
            {category !== "all" ? <input type="hidden" name="category" value={category} /> : null}
            <button type="submit" className="btn-gold mt-4 w-full py-2 text-[12.5px]">
              {t("filters")}
            </button>
            <Link href="/catalog" className="mt-2 block text-center text-[11px] text-[#a09db3] hover:text-[#f0dcae]">
              {locale === "ar" ? "إعادة ضبط" : "Reset"}
            </Link>
          </form>

          <div className="glass rounded-2xl p-4">
            <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-[#b3a98f]">{t("category")}</p>
            <ul className="space-y-1 text-[12.5px]">
              <li>
                <Link
                  href={`/catalog${q ? `?q=${encodeURIComponent(q)}` : ""}`}
                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${category === "all" ? "bg-[rgba(217,178,106,0.14)] text-[#f7eccd]" : "text-[#b6b1c3] hover:text-[#f0dcae]"}`}
                >
                  <span>{t("all_categories")}</span>
                  <span className="tabular text-[11px] text-[#8f8ba2]">{total}</span>
                </Link>
              </li>
              {categoryOptions.map((item) => (
                <li key={item.value}>
                  <Link
                    href={`/catalog?category=${item.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${category === item.value ? "bg-[rgba(217,178,106,0.14)] text-[#f7eccd]" : "text-[#b6b1c3] hover:text-[#f0dcae]"}`}
                  >
                    <span>
                      <span aria-hidden="true" className="me-1.5">
                        {item.glyph}
                      </span>
                      {categoryLabel(item.value, locale)}
                    </span>
                    <span className="tabular text-[11px] text-[#8f8ba2]">{counts[item.value] ?? 0}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="glass rounded-2xl p-4 text-[12px] leading-relaxed text-[#a9a4b8]">
            <p className="mb-1 font-display text-sm text-[#f0dcae]">{locale === "ar" ? "لم تجد ما يناسبك؟" : "Not sure yet?"}</p>
            <p>
              {locale === "ar"
                ? "موظف الاستقبال الاصطناعي يسألك سؤالين ويرشّح لك ثلاثة منتجات بدقة."
                : "Our AI reception agent asks two questions and recommends three precise options."}
            </p>
            <Link href="/agents" className="btn-ghost mt-3 w-full text-[11.5px]">
              {t("talk_to_agent")}
            </Link>
          </div>
        </aside>

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-[#a8a4b8]">
              <span className="tabular text-[#f0dcae]">{total}</span> {t("results")}
              {q ? ` — “${q}”` : ""}
            </p>
            <p className="text-[11px] text-[#8f8ba2]">
              {locale === "ar" ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
            </p>
          </div>

          {items.length === 0 ? (
            <EmptyState
              title={t("no_results")}
              description={
                locale === "ar"
                  ? "جرّب كلمة أعم أو أزل الفلاتر. يمكنك أيضًا أن تسأل موظف الاستقبال الاصطناعي وسيرشح لك الأنسب من الكتالوج."
                  : "Try a broader keyword or clear the filters. You can also ask our AI reception agent for a tailored recommendation."
              }
              action={{ href: "/agents", label: t("talk_to_agent") }}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  locale={locale}
                  currency={currency}
                  labels={{ details: t("details"), save: t("add_to_wishlist") }}
                />
              ))}
            </div>
          )}

          {totalPages > 1 ? (
            <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Pagination">
              {page > 1 ? (
                <Link href={buildPage(page - 1)} className="btn-ghost px-3 py-1.5 text-[11.5px]">
                  {locale === "ar" ? "السابق" : "Previous"}
                </Link>
              ) : null}
              {Array.from({ length: totalPages }, (_, index) => index + 1)
                .filter((value) => Math.abs(value - page) <= 2 || value === 1 || value === totalPages)
                .map((value) => (
                  <Link
                    key={value}
                    href={buildPage(value)}
                    aria-current={value === page ? "page" : undefined}
                    className={`tabular flex h-8 w-8 items-center justify-center rounded-full border text-[12px] ${
                      value === page
                        ? "border-[rgba(217,178,106,0.6)] bg-[rgba(217,178,106,0.18)] text-[#f7eccd]"
                        : "border-white/10 text-[#b6b1c3] hover:border-[rgba(217,178,106,0.4)]"
                    }`}
                  >
                    {value}
                  </Link>
                ))}
              {page < totalPages ? (
                <Link href={buildPage(page + 1)} className="btn-ghost px-3 py-1.5 text-[11.5px]">
                  {locale === "ar" ? "التالي" : "Next"}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
