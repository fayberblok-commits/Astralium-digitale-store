import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "../../../i18n/dictionaries";
import { isLocale } from "../../../i18n/locales";
import { getFlag } from "../../../lib/flags";
import { listBlogPosts } from "../../../lib/blog";
import { siteUrl } from "../../../lib/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const dict = getDictionary(locale);
  return {
    title: dict.blog_t,
    description: dict.blog_d,
    alternates: { canonical: `/${locale}/blog` },
    openGraph: { title: `${dict.blog_t} · Astralium Digitale Store`, description: dict.blog_d, type: "website", url: `${siteUrl()}/${locale}/blog` },
    twitter: { card: "summary_large_image", title: dict.blog_t, description: dict.blog_d },
  };
}

export default async function BlogIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (!(await getFlag("blog"))) notFound();
  const dict = getDictionary(locale);
  const posts = await listBlogPosts({ locale, status: "published" });
  return (
    <>
      <h1 style={{ marginTop: 28 }}>{dict.blog_t}</h1>
      <p className="muted">{dict.blog_d}</p>
      {posts.length === 0 ? (
        <div className="panel" style={{ marginTop: 20 }}>
          <p>{dict.blog_empty}</p>
        </div>
      ) : (
        <div className="grid" style={{ marginTop: 20 }}>
          {posts.map((post) => (
            <article key={post.id} className="panel">
              <h2 style={{ marginTop: 0 }}>
                <Link href={`/${locale}/blog/${post.slug}`}>{post.title}</Link>
              </h2>
              <p className="muted">
                {dict.blog_published_on} {new Date(post.publishedAt ?? post.createdAt).toLocaleDateString(locale)}
              </p>
              <p>{post.excerpt}</p>
              <Link href={`/${locale}/blog/${post.slug}`} className="btn btn-ghost">{dict.blog_read_more}</Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
