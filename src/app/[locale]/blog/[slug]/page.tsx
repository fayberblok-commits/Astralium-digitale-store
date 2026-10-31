import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "../../../../i18n/dictionaries";
import { isLocale } from "../../../../i18n/locales";
import { getFlag } from "../../../../lib/flags";
import { getBlogPost, renderMarkdown } from "../../../../lib/blog";
import { buildBreadcrumbJsonLd } from "../../../../lib/seo";
import { siteUrl } from "../../../../lib/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getBlogPost(locale, slug);
  if (!post) return {};
  const url = `${siteUrl()}/${locale}/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/${locale}/blog/${post.slug}` },
    openGraph: { title: post.title, description: post.excerpt, type: "article", url, publishedTime: post.publishedAt ?? undefined },
    twitter: { card: "summary_large_image", title: post.title, description: post.excerpt },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  if (!(await getFlag("blog"))) notFound();
  const post = await getBlogPost(locale, slug);
  if (!post) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const dict = getDictionary(locale);
  const base = siteUrl();

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    url: `${base}/${locale}/blog/${post.slug}`,
    datePublished: post.publishedAt ?? post.createdAt,
    dateModified: post.updatedAt,
    inLanguage: locale,
    author: { "@type": "Organization", name: "Astralium Digitale Store" },
  };
  const breadcrumbLd = buildBreadcrumbJsonLd({
    siteBase: base,
    locale,
    trail: [
      { name: dict.nav_home, path: "" },
      { name: dict.blog_t, path: "/blog" },
      { name: post.title, path: `/blog/${post.slug}` },
    ],
  });

  return (
    <>
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <article style={{ marginTop: 28, maxWidth: 760 }}>
        <p>
          <Link href={`/${locale}/blog`}>← {dict.blog_back}</Link>
        </p>
        <h1>{post.title}</h1>
        <p className="muted">
          {dict.blog_published_on} {new Date(post.publishedAt ?? post.createdAt).toLocaleDateString(locale)}
        </p>
        {/* renderMarkdown escapes all raw HTML first — safe by design. */}
        <div className="blog-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(post.bodyMd) }} />
      </article>
    </>
  );
}
