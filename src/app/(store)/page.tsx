import Image from "next/image";
import Link from "next/link";
import { and, eq, gte, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import { coupons } from "@/db/schema";
import { cookies } from "next/headers";
import { CoverArt, ProductCard, SectionHeading } from "@/components/ui";
import { getLocaleContext } from "@/lib/locale";
import { CATEGORIES, categoryLabel } from "@/lib/i18n";
import { CURRENCIES } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { getAgents, getBlogPosts, getCategoryCounts, getFeaturedProducts, getNewestProducts } from "@/lib/store";

export default async function HomePage() {
  const { locale, t } = await getLocaleContext();
  const settings = await getSettings();
  const cookieStore = await cookies();
  const requested = cookieStore.get("astralium_currency")?.value ?? "USD";
  const currency = CURRENCIES.some((item) => item.code === requested) ? requested : "USD";

  const [featured, newest, agents, posts, counts, liveCoupons] = await Promise.all([
    getFeaturedProducts(4),
    getNewestProducts(3),
    getAgents("customer"),
    getBlogPosts(3),
    getCategoryCounts(),
    db
      .select()
      .from(coupons)
      .where(and(eq(coupons.active, true), or(isNull(coupons.expiresAt), gte(coupons.expiresAt, new Date()))))
      .limit(2),
  ]);

  const heroTitle = locale === "ar" ? settings.heroTitleAr : settings.heroTitleEn;
  const heroSubtitle = locale === "ar" ? settings.heroSubtitleAr : settings.heroSubtitleEn;
  const totalProducts = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-[rgba(217,178,106,0.14)]">
        <Image
          src={settings.heroImage}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05060f]/70 via-[#05060f]/82 to-[#05060f]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:py-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="animate-fade-up">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(217,178,106,0.3)] bg-[rgba(217,178,106,0.08)] px-3 py-1 text-[10.5px] uppercase tracking-[0.3em] text-[#eeddb5]">
              <span aria-hidden="true">✦</span> {t("hero_eyebrow")}
            </p>
            <h1 className="font-display text-4xl leading-[1.15] text-[#f8f3e6] sm:text-5xl lg:text-6xl">{heroTitle}</h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#c2bdcd] sm:text-base">{heroSubtitle}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/catalog" className="btn-gold">
                {t("hero_cta")} <span aria-hidden="true">←</span>
              </Link>
              <Link href="/agents" className="btn-ghost">
                {t("hero_cta_alt")} <span aria-hidden="true">◈</span>
              </Link>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t border-[rgba(217,178,106,0.16)] pt-5">
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[#a09db3]">{locale === "ar" ? "منتجات منشورة" : "Published goods"}</dt>
                <dd className="tabular font-display text-2xl text-[#f0dcae]">{totalProducts}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[#a09db3]">{locale === "ar" ? "لغات مدعومة" : "Languages"}</dt>
                <dd className="tabular font-display text-2xl text-[#f0dcae]">{settings.enabledLocales.length}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-[0.2em] text-[#a09db3]">{locale === "ar" ? "تسليم فوري" : "Delivery"}</dt>
                <dd className="font-display text-2xl text-[#f0dcae]">{locale === "ar" ? "٠ دقيقة" : "0 min"}</dd>
              </div>
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] border border-[rgba(217,178,106,0.18)]" aria-hidden="true" />
            <div className="glass animate-float rounded-[1.6rem] p-5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-[0.28em] text-[#d9b26a]">{t("featured")}</span>
                <span className="chip">✦ {locale === "ar" ? "إصدار محدود" : "Limited edition"}</span>
              </div>
              {featured[0] ? (
                <Link href={`/product/${featured[0].slug}`} className="mt-4 block">
                  <CoverArt
                    title={locale === "ar" ? featured[0].title : featured[0].titleEn || featured[0].title}
                    coverStyle={featured[0].coverStyle}
                    glyph={featured[0].coverGlyph}
                    className="aspect-[5/4] w-full"
                  />
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-[#a99c83]">
                        {categoryLabel(featured[0].category, locale)}
                      </p>
                      <p className="mt-1 font-display text-lg text-[#f6f1e3]">
                        {locale === "ar" ? featured[0].title : featured[0].titleEn || featured[0].title}
                      </p>
                    </div>
                    <span className="btn-ghost whitespace-nowrap text-[11px]">{t("details")}</span>
                  </div>
                </Link>
              ) : (
                <p className="mt-6 text-sm text-[#a09db3]">
                  {locale === "ar"
                    ? "تُنشر الإصدارات من مكتب المدير وتظهر هنا فور نشرها."
                    : "Releases are published from the owner's office and appear here instantly."}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-b border-[rgba(217,178,106,0.1)] bg-[rgba(8,10,22,0.6)]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 py-6 text-center sm:grid-cols-4">
          {[
            { icon: "⚡", ar: "تسليم فوري بعد الدفع", en: "Instant delivery" },
            { icon: "🔒", ar: "دفع مشفّر وحماية كاملة", en: "Encrypted payments" },
            { icon: "🎧", ar: "دعم بلغتك 12 لغة", en: "Support in 12 languages" },
            { icon: "♾", ar: "وصول دائم لمشترياتك", en: "Lifetime access" },
          ].map((item) => (
            <div key={item.en} className="flex flex-col items-center gap-1.5">
              <span aria-hidden="true" className="text-lg text-[#d9b26a]">
                {item.icon}
              </span>
              <span className="text-[11.5px] text-[#c7c2d2]">{locale === "ar" ? item.ar : item.en}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Featured products */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <SectionHeading
          eyebrow={t("hero_eyebrow")}
          title={t("featured")}
          description={
            locale === "ar"
              ? "أعمال مختارة من المكتبة: كل منتج مراجَع من حيث الجودة، ووصفه وترخيصه مكتوبان بوضوح."
              : "Selected works from the library — quality reviewed, with clear descriptions and licensing."
          }
          action={{ href: "/catalog", label: t("view_all") }}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              locale={locale}
              currency={currency}
              labels={{ details: t("details"), save: t("add_to_wishlist") }}
            />
          ))}
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 pb-14">
        <SectionHeading
          eyebrow={locale === "ar" ? "تصنيفات" : "Collections"}
          title={locale === "ar" ? "كل ما هو رقمي، في مكان واحد" : "Everything digital, in one house"}
          description={
            locale === "ar"
              ? "تنقّل بين صيغ المحتوى الرقمي: معرفة مكتوبة ومسموعة، أدوات عمل، وأصول بصرية جاهزة للاستخدام."
              : "Move between formats: written and spoken knowledge, working tools and ready-to-use visual assets."
          }
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.filter((category) => (counts[category.value] ?? 0) > 0 || category.value === "bundle").map((category) => (
            <Link
              key={category.value}
              href={`/catalog?category=${category.value}`}
              className="glass card-lift group rounded-2xl p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xl" aria-hidden="true">
                  {category.glyph}
                </span>
                <span className="tabular text-[10px] text-[#a09db3]">{counts[category.value] ?? 0}</span>
              </div>
              <p className="mt-3 text-sm text-[#eee9dd]">{categoryLabel(category.value, locale)}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#8d89a0] group-hover:text-[#d9b26a]">
                {locale === "ar" ? "استعرض" : "Browse"}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* New arrivals + offers */}
      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-14 lg:grid-cols-[1.35fr_0.65fr]">
        <div>
          <SectionHeading eyebrow={t("new")} title={t("new")} action={{ href: "/catalog?sort=newest", label: t("view_all") }} />
          <div className="grid gap-4 sm:grid-cols-3">
            {newest.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                locale={locale}
                currency={currency}
                labels={{ details: t("details"), save: t("add_to_wishlist") }}
              />
            ))}
          </div>
        </div>
        <div className="glass relative overflow-hidden rounded-2xl p-6">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(217,178,106,0.28),transparent_70%)]" />
          <p className="text-[10px] uppercase tracking-[0.28em] text-[#d9b26a]">{t("nav_offers")}</p>
          <h3 className="mt-2 font-display text-2xl text-[#f6f1e3]">
            {locale === "ar" ? "عروض المتجر الحالية" : "Current store offers"}
          </h3>
          <p className="mt-2 text-[13px] leading-relaxed text-[#b0abbd]">
            {locale === "ar"
              ? "كوبونات مُدارة من مكتب المدير، تُطبَّق تلقائيًا عند إتمام الشراء."
              : "Coupons managed from the owner's office and applied automatically at checkout."}
          </p>
          <div className="mt-5 space-y-3">
            {liveCoupons.length === 0 ? (
              <p className="text-[13px] text-[#a09db3]">
                {locale === "ar" ? "لا توجد كوبونات نشطة الآن. تابع المدونة لأول عرض قادم." : "No active coupons right now — follow the journal for the next release."}
              </p>
            ) : (
              liveCoupons.map((coupon) => (
                <div key={coupon.id} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[rgba(217,178,106,0.35)] px-3 py-2.5">
                  <div>
                    <p className="font-mono text-sm tracking-[0.15em] text-[#f0dcae]">{coupon.code}</p>
                    <p className="text-[11px] text-[#a09db3]">
                      {coupon.kind === "percent" ? `${coupon.value}% ${locale === "ar" ? "خصم" : "off"}` : `${(coupon.value / 100).toFixed(2)} USD ${locale === "ar" ? "خصم" : "off"}`}
                    </p>
                  </div>
                  <span className="chip">{locale === "ar" ? "نشط" : "Active"}</span>
                </div>
              ))
            )}
          </div>
          <Link href="/offers" className="btn-ghost mt-6 w-full">
            {locale === "ar" ? "كل العروض" : "All offers"}
          </Link>
        </div>
      </section>

      {/* AI agents */}
      <section className="border-y border-[rgba(217,178,106,0.12)] bg-[rgba(7,9,20,0.6)]">
        <div className="mx-auto max-w-7xl px-4 py-14">
          <SectionHeading
            eyebrow={t("nav_agents")}
            title={t("agents_title")}
            description={t("agents_subtitle")}
            action={{ href: "/agents", label: t("talk_to_agent") }}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {agents.slice(0, 4).map((agent) => (
              <Link key={agent.id} href={`/agents?agent=${agent.slug}`} className="glass card-lift rounded-2xl p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgba(217,178,106,0.35)] bg-[rgba(217,178,106,0.1)] text-lg" aria-hidden="true">
                  {agent.glyph}
                </span>
                <p className="mt-3 font-display text-lg text-[#f4efe3]">{agent.name}</p>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#bfae88]">{agent.title}</p>
                <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-[#a8a4b8]">
                  {locale === "ar" ? agent.specialty : agent.title}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-[11px] text-[#d9b26a]">
                  {t("talk_to_agent")} <span aria-hidden="true">←</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Atelier / about */}
      <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-16 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-3xl border border-[rgba(217,178,106,0.22)]">
          <Image src="/images/astral-atelier.jpg" alt="" width={900} height={900} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#05060f]/80 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 right-4">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#e6d6ae]">
              {locale === "ar" ? "بيت رقمي مستقل" : "An independent digital house"}
            </p>
          </div>
        </div>
        <div>
          <SectionHeading
            eyebrow={t("nav_about")}
            title={locale === "ar" ? "نُصمّم المعرفة كما تستحق أن تُقدَّم" : "We design knowledge as it deserves to be presented"}
          />
          <p className="text-[14px] leading-loose text-[#b7b2c4]">{locale === "ar" ? settings.aboutAr : settings.aboutEn}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              { ar: "مراجعة جودة قبل النشر", en: "Quality review before publishing" },
              { ar: "تراخيص واضحة وقابلة للتحقق", en: "Clear, verifiable licensing" },
              { ar: "دعم بشري واصطناعي معًا", en: "Human + AI support together" },
              { ar: "بيانات دفع محمية", en: "Protected payment data" },
            ].map((item) => (
              <div key={item.en} className="flex items-start gap-2 text-[13px] text-[#cbc6d6]">
                <span aria-hidden="true" className="text-[#d9b26a]">
                  ✦
                </span>
                {locale === "ar" ? item.ar : item.en}
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/about" className="btn-gold">
              {t("nav_about")}
            </Link>
            <Link href="/contact" className="btn-ghost">
              {t("nav_contact")}
            </Link>
          </div>
        </div>
      </section>

      {/* Journal */}
      <section className="mx-auto max-w-7xl px-4 pb-16">
        <SectionHeading
          eyebrow={t("nav_blog")}
          title={locale === "ar" ? "من مدونة أسترا" : "From the Astralium journal"}
          action={{ href: "/blog", label: t("view_all") }}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          {posts.map((post) => (
            <Link key={post.id} href={`/blog/${post.slug}`} className="glass card-lift rounded-2xl p-5">
              <span className="chip">{post.category}</span>
              <h3 className="mt-3 font-display text-lg leading-snug text-[#f4efe3]">{post.title}</h3>
              <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-[#a8a4b8]">{post.excerpt}</p>
              <span className="mt-3 inline-block text-[11px] text-[#d9b26a]">{locale === "ar" ? "اقرأ المقال" : "Read article"} ←</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
