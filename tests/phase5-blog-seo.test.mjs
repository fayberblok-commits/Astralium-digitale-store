import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.chdir(mkdtempSync(path.join(tmpdir(), "astralium-p5-blog-")));
delete process.env.DATABASE_URL;

const blog = await import("../src/lib/blog.ts");
const seo = await import("../src/lib/seo.ts");
const { PRODUCTS } = await import("../src/data/products.ts");

test("markdown: headings, bold, lists, quotes and code render", () => {
  const html = blog.renderMarkdown("# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n> a quote\n\n`code` inline");
  assert.ok(html.includes("<h1>Title</h1>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>italic</em>"));
  assert.ok(html.includes("<ul><li>one</li><li>two</li></ul>"));
  assert.ok(html.includes("<blockquote>a quote</blockquote>"));
  assert.ok(html.includes("<code>code</code>"));
});

test("markdown SAFETY: raw HTML is escaped, never injected", () => {
  const html = blog.renderMarkdown('Hello <script>alert("xss")</script> and <img src=x onerror=alert(1)>');
  assert.ok(!html.includes("<script>"), "script tag must not survive");
  assert.ok(!html.includes("<img src=x"), "raw img must not survive");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img"));
});

test("markdown SAFETY: javascript:/data: links are not linked; https links are", () => {
  const bad = blog.renderMarkdown("[click](javascript:alert(1)) and [d](data:text/html;base64,PHNjcmlwdD4=)");
  assert.ok(!bad.includes('href="javascript:'));
  assert.ok(!bad.includes('href="data:'));
  const good = blog.renderMarkdown("[site](https://example.com/page) and [mail](mailto:a@b.co)");
  assert.ok(good.includes('href="https://example.com/page"'));
  assert.ok(good.includes('href="mailto:a@b.co"'));
});

test("markdown: fenced code is escaped verbatim (no formatting inside)", () => {
  const html = blog.renderMarkdown("```\nconst x = **not bold** <b>\n```");
  assert.ok(html.includes("<pre><code>"));
  assert.ok(html.includes("**not bold**"));
  assert.ok(html.includes("&lt;b&gt;"));
  assert.ok(!html.includes("<strong>not bold</strong>"));
});

test("slugify + excerpt helpers", () => {
  assert.equal(blog.slugify("The Art of Deep Focus!"), "the-art-of-deep-focus");
  assert.equal(blog.slugify("Café Über Alles"), "cafe-uber-alles");
  assert.equal(blog.slugify("!!!"), "post");
  const ex = blog.excerptFromBody("# Heading\n\nSome **body** text here for the excerpt.");
  assert.ok(ex.includes("Some body text"));
  assert.ok(!ex.includes("**"));
});

test("posts: draft by default, publish flow, locale filtering, delete", async () => {
  const saved = await blog.saveBlogPost({ title: "Focus Notes", bodyMd: "A body long enough to save.", locale: "en" });
  assert.equal(saved.ok, true);
  assert.equal(saved.post.status, "draft"); // never published by accident
  assert.equal(saved.post.slug, "focus-notes");
  assert.equal(await blog.getBlogPost("en", "focus-notes"), null); // drafts are invisible
  const published = await blog.saveBlogPost({ id: saved.post.id, title: "Focus Notes", bodyMd: "A body long enough to save.", locale: "en", status: "published" });
  assert.equal(published.post.status, "published");
  assert.ok(published.post.publishedAt);
  const visible = await blog.getBlogPost("en", "focus-notes");
  assert.equal(visible.id, saved.post.id);
  const arList = await blog.listBlogPosts({ locale: "ar", status: "published" });
  assert.equal(arList.length, 0);
  const bad = await blog.saveBlogPost({ title: "x", bodyMd: "short" });
  assert.equal(bad.ok, false);
  const del = await blog.deleteBlogPost(saved.post.id);
  assert.equal(del.ok, true);
  assert.equal(await blog.getBlogPost("en", "focus-notes"), null);
});

test("sitemap entries: locales × (static + products + legal) + blog in its own locale only", () => {
  const entries = seo.buildSitemapEntries({
    base: "https://store.example/",
    locales: ["en", "ar"],
    products: [{ slug: "alpha", publishedAt: "2026-01-01" }, { slug: "beta", publishedAt: "2026-02-01" }],
    legalSlugs: ["terms"],
    blogPosts: [{ slug: "hello", locale: "en", updatedAt: "2026-03-01" }],
    includeBlog: true,
  });
  const urls = entries.map((e) => e.url);
  assert.ok(urls.includes("https://store.example/en"));
  assert.ok(urls.includes("https://store.example/ar/blog"));
  assert.ok(urls.includes("https://store.example/en/product/alpha"));
  assert.ok(urls.includes("https://store.example/ar/legal/terms"));
  assert.ok(urls.includes("https://store.example/en/blog/hello"));
  assert.ok(!urls.includes("https://store.example/ar/blog/hello"), "a post appears only under its own locale");
  // 2 locales × (3 static + blog + 2 products + 1 legal) + 1 post = 15
  assert.equal(entries.length, 15);
  const noBlog = seo.buildSitemapEntries({
    base: "https://store.example", locales: ["en"],
    products: [], legalSlugs: [], blogPosts: [], includeBlog: false,
  });
  assert.ok(!noBlog.some((e) => e.url.includes("/blog")));
});

test("product JSON-LD: Offer is real; AggregateRating appears ONLY from real reviews", () => {
  const product = PRODUCTS[0];
  const bare = seo.buildProductJsonLd({ product, locale: "en", siteBase: "https://store.example", reviewAgg: null });
  assert.equal(bare["@type"], "Product");
  assert.equal(bare.offers.price, product.priceUSD.toFixed(2));
  assert.ok(!("aggregateRating" in bare), "no approved reviews → no aggregate block (seed ratings stay out)");
  const withReviews = seo.buildProductJsonLd({
    product, locale: "en", siteBase: "https://store.example", reviewAgg: { count: 4, average: 4.5 },
  });
  assert.equal(withReviews.aggregateRating.reviewCount, 4);
  assert.equal(withReviews.aggregateRating.ratingValue, 4.5);
  const zero = seo.buildProductJsonLd({
    product, locale: "en", siteBase: "https://store.example", reviewAgg: { count: 0, average: 0 },
  });
  assert.ok(!("aggregateRating" in zero));
});

test("breadcrumb JSON-LD mirrors the real trail", () => {
  const ld = seo.buildBreadcrumbJsonLd({
    siteBase: "https://store.example", locale: "ar",
    trail: [{ name: "Home", path: "" }, { name: "Shop", path: "/shop" }, { name: "Book", path: "/product/book" }],
  });
  assert.equal(ld["@type"], "BreadcrumbList");
  assert.deepEqual(ld.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.equal(ld.itemListElement[2].item, "https://store.example/ar/product/book");
});
