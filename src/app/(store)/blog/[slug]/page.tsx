import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBlogPost, getBlogPosts } from "@/lib/store";
import { getLocaleContext, formatDate } from "@/lib/locale";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPost(slug);
  if (!post) return { title: "المقال غير موجود" };
  return { title: post.title, description: post.excerpt, openGraph: { title: post.title, description: post.excerpt, type: "article" } };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const { locale, t } = await getLocaleContext();
  const post = await getBlogPost(slug);
  if (!post || !post.published) notFound();
  const others = (await getBlogPosts(4)).filter((item) => item.slug !== post.slug).slice(0, 3);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt.toISOString(),
    author: { "@type": "Organization", name: "Astralium Digitale Store" },
    publisher: { "@type": "Organization", name: "Astralium Digitale Store" },
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav className="mb-4 text-[11px] text-[#8f8ba2]">
        <Link href="/" className="hover:text-[#f0dcae]">
          {t("nav_home")}
        </Link>
        <span className="mx-2">/</span>
        <Link href="/blog" className="hover:text-[#f0dcae]">
          {t("nav_blog")}
        </Link>
      </nav>
      <span className="chip">{post.category}</span>
      <h1 className="mt-3 font-display text-3xl leading-tight text-[#f8f3e6] sm:text-4xl">{post.title}</h1>
      <p className="mt-2 text-[11.5px] text-[#8f8ba2]">{formatDate(post.publishedAt, locale)}</p>
      <p className="mt-4 rounded-xl border border-[rgba(217,178,106,0.2)] bg-[rgba(217,178,106,0.05)] px-4 py-3 text-[13px] leading-relaxed text-[#d8cbaa]">
        {post.excerpt}
      </p>
      <article className="prose-luxe mt-6">
        {post.body
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => {
            if (line.startsWith("## ")) {
              return <h2 key={line.slice(0, 40)}>{line.replace("## ", "")}</h2>;
            }
            if (line.startsWith("- ")) {
              return (
                <ul key={line.slice(0, 40)}>
                  <li>{line.replace("- ", "")}</li>
                </ul>
              );
            }
            return <p key={line.slice(0, 40)}>{line}</p>;
          })}
      </article>

      <div className="glass mt-8 rounded-2xl p-5">
        <p className="font-display text-lg text-[#f4efe3]">{locale === "ar" ? "مقالات أخرى" : "More articles"}</p>
        <ul className="mt-3 space-y-2">
          {others.map((item) => (
            <li key={item.id}>
              <Link href={`/blog/${item.slug}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[12.5px] text-[#c3bece] hover:bg-white/[0.03] hover:text-[#f0dcae]">
                <span>{item.title}</span>
                <span aria-hidden="true">←</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
