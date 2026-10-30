import Link from "next/link";
import type { Metadata } from "next";
import { getLocaleContext, formatDate } from "@/lib/locale";
import { getBlogPosts } from "@/lib/store";

export const metadata: Metadata = {
  title: "المدونة والأخبار",
  description: "مقالات Astralium Digitale Store عن المنتجات الرقمية، الترخيص، الإنتاجية، وتصميم الأصول الرقمية.",
};

export default async function BlogPage() {
  const { locale, t } = await getLocaleContext();
  const posts = await getBlogPosts();
  const [lead, ...rest] = posts;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <p className="text-[10px] uppercase tracking-[0.32em] text-[#d9b26a]">{t("nav_blog")}</p>
      <h1 className="mt-2 font-display text-3xl text-[#f8f3e6] sm:text-4xl">{locale === "ar" ? "مدونة أسترا" : "The Astralium journal"}</h1>
      <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[#b1acc0]">
        {locale === "ar"
          ? "ملاحظات تحريرية عن صناعة المنتجات الرقمية، ترخيص المحتوى، واختيار الأدوات التي تستحق وقتك."
          : "Editorial notes on making digital products, content licensing, and choosing tools that deserve your time."}
      </p>

      {!lead ? (
        <div className="glass mt-8 rounded-2xl p-8 text-center text-[13px] text-[#a9a4b8]">
          {locale === "ar" ? "لا توجد مقالات منشورة بعد." : "No published articles yet."}
        </div>
      ) : (
        <>
          <Link href={`/blog/${lead.slug}`} className="glass card-lift mt-8 grid gap-5 rounded-2xl p-5 md:grid-cols-[1fr_1.3fr]">
            <div className="relative overflow-hidden rounded-xl border border-[rgba(217,178,106,0.25)] bg-gradient-to-br from-[#1b1740] via-[#2b1f55] to-[#090a1c] p-6">
              <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(1px_1px_at_20%_25%,#fff,transparent),radial-gradient(1.4px_1.4px_at_72%_18%,#f0dcae,transparent),radial-gradient(1px_1px_at_84%_70%,#fff,transparent)]" />
              <span className="chip relative">{lead.category}</span>
              <p className="relative mt-6 font-display text-2xl leading-snug text-[#f8f3e6]">{lead.title}</p>
            </div>
            <div>
              <p className="text-[10.5px] uppercase tracking-[0.22em] text-[#a99c83]">{formatDate(lead.publishedAt, locale)}</p>
              <p className="mt-3 text-[13.5px] leading-loose text-[#b3aec1]">{lead.excerpt}</p>
              <span className="btn-ghost mt-5 inline-flex text-[11.5px]">{locale === "ar" ? "اقرأ المقال" : "Read the article"}</span>
            </div>
          </Link>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((post) => (
              <Link key={post.id} href={`/blog/${post.slug}`} className="glass card-lift rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="chip">{post.category}</span>
                  <span className="text-[10px] text-[#8f8ba2]">{formatDate(post.publishedAt, locale)}</span>
                </div>
                <h2 className="mt-3 font-display text-lg leading-snug text-[#f4efe3]">{post.title}</h2>
                <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-[#a8a4b8]">{post.excerpt}</p>
                <span className="mt-3 inline-block text-[11px] text-[#d9b26a]">{locale === "ar" ? "اقرأ المزيد" : "Read more"} ←</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="glass mt-10 flex flex-col items-center gap-3 rounded-2xl p-6 text-center">
        <p className="font-display text-xl text-[#f4efe3]">{locale === "ar" ? "تصلك الإصدارات أولًا" : "Get releases first"}</p>
        <p className="max-w-lg text-[12.5px] leading-relaxed text-[#a9a4b8]">
          {locale === "ar"
            ? "اشترك في النشرة البريدية لتصلك الإصدارات الجديدة وأكواد الخصم المخصصة للمشتركين."
            : "Subscribe for new releases and subscriber-only discount codes."}
        </p>
        <Link href="/offers" className="btn-gold">
          {t("nav_offers")}
        </Link>
      </div>
    </div>
  );
}
