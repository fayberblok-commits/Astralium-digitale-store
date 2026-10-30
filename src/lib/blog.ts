/**
 * Blog engine (Phase 5, feature 21). Flag `blog` — default ON.
 *
 * Posts are owner-authored (admin), draft by default, and rendered with
 * a small SAFE markdown renderer: the source is HTML-escaped FIRST and
 * only a whitelist of markdown constructs is then turned into tags, so
 * raw HTML in a post can never reach a reader's browser as markup.
 * Links/images are scheme-checked (http/https/mailto, site-relative).
 *
 * Persistence: DB BlogPost table when configured, else
 * .data/blog-posts.json — the config-store pattern of earlier phases.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { isLocale } from "../i18n/locales.ts";

// ─── Safe markdown renderer ──────────────────────────────────────────────────

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^\/(?!\/)/.test(url)) return url; // site-relative, never protocol-relative
  return null;
}

/** Inline formatting on ALREADY-escaped text. Code spans are extracted
 * first so their contents are never re-processed. */
export function renderInline(escaped: string): string {
  const codeSpans: string[] = [];
  let out = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt: string, url: string) => {
    const safe = safeUrl(url.replace(/&amp;/g, "&"));
    return safe && /^https?:\/\//i.test(safe)
      ? `<img src="${safe}" alt="${alt}" loading="lazy" />`
      : m;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const safe = safeUrl(url.replace(/&amp;/g, "&"));
    return safe ? `<a href="${safe}" rel="noreferrer">${text}</a>` : m;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codeSpans[Number(i)]}</code>`);
  return out;
}

/**
 * Render markdown to HTML. Supported: #–###### headings, paragraphs,
 * - / * and 1. lists, > blockquotes, ``` code fences, --- rules, and the
 * inline set above. Everything else is literal (escaped) text.
 */
export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md.replace(/\r\n/g, "\n")).split("\n");
  const html: string[] = [];
  let i = 0;
  const isBlockStart = (line: string) =>
    /^#{1,6}\s/.test(line) || /^```/.test(line) || /^\s*(-|\*)\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) || /^&gt;\s?/.test(line) || /^\s*(-{3,}|\*{3,})\s*$/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      html.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { html.push("<hr />"); i++; continue; }
    if (/^&gt;\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^&gt;\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*(-|\*)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*(-|\*)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*(-|\*)\s+/, ""));
        i++;
      }
      html.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      html.push(`<ol>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    html.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }
  return html.join("\n");
}

/** Plain-text excerpt when the owner leaves the excerpt field empty. */
export function excerptFromBody(md: string, max = 160): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`\-\[\]()!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "post";
}

// ─── Posts & persistence ─────────────────────────────────────────────────────

export interface BlogPostRecord {
  id: string;
  slug: string;
  locale: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

const STORE_PATH = path.join(process.cwd(), ".data", "blog-posts.json");

async function readStore(): Promise<BlogPostRecord[]> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as BlogPostRecord[];
  } catch {
    return [];
  }
}

async function writeStore(list: BlogPostRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

type PostRow = {
  id: string; slug: string; locale: string; title: string; excerpt: string; bodyMd: string;
  status: string; createdAt: Date; updatedAt: Date; publishedAt: Date | null;
};

function fromRow(r: PostRow): BlogPostRecord {
  return {
    id: r.id, slug: r.slug, locale: r.locale, title: r.title, excerpt: r.excerpt,
    bodyMd: r.bodyMd, status: r.status === "published" ? "published" : "draft",
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    publishedAt: r.publishedAt?.toISOString() ?? null,
  };
}

export function sanitizeBlogPostInput(input: {
  id?: unknown; slug?: unknown; locale?: unknown; title?: unknown;
  excerpt?: unknown; bodyMd?: unknown; status?: unknown;
}): { ok: true; value: Omit<BlogPostRecord, "id" | "createdAt" | "updatedAt" | "publishedAt"> & { id?: string } } | { ok: false; error: string } {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const title = str(input.title, 200);
  const bodyMd = typeof input.bodyMd === "string" ? input.bodyMd.slice(0, 100_000) : "";
  if (title.length < 3) return { ok: false, error: "INVALID_TITLE" };
  if (bodyMd.trim().length < 10) return { ok: false, error: "INVALID_BODY" };
  const locale = typeof input.locale === "string" && isLocale(input.locale) ? input.locale : "en";
  const slugRaw = str(input.slug, 90);
  const slug = slugRaw ? slugify(slugRaw) : slugify(title);
  return {
    ok: true,
    value: {
      id: typeof input.id === "string" && input.id ? input.id : undefined,
      slug,
      locale,
      title,
      excerpt: str(input.excerpt, 300) || excerptFromBody(bodyMd),
      bodyMd,
      status: input.status === "published" ? "published" : "draft",
    },
  };
}

export async function listBlogPosts(opts: { locale?: string; status?: "draft" | "published" } = {}): Promise<BlogPostRecord[]> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const rows = await db.blogPost.findMany({
        where: {
          ...(opts.locale ? { locale: opts.locale } : {}),
          ...(opts.status ? { status: opts.status } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
      });
      if (rows.length > 0) return rows.map(fromRow);
    } catch { /* fall through */ }
  }
  return (await readStore())
    .filter((p) => (!opts.locale || p.locale === opts.locale) && (!opts.status || p.status === opts.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBlogPost(locale: string, slug: string, publishedOnly = true): Promise<BlogPostRecord | null> {
  const posts = await listBlogPosts({ locale });
  return posts.find((p) => p.slug === slug && (!publishedOnly || p.status === "published")) ?? null;
}

export async function saveBlogPost(
  input: Parameters<typeof sanitizeBlogPostInput>[0],
): Promise<{ ok: true; post: BlogPostRecord; persisted: "db" | "file" } | { ok: false; error: string }> {
  const clean = sanitizeBlogPostInput(input);
  if (!clean.ok) return clean;
  const v = clean.value;
  const now = new Date().toISOString();
  const all = await readStore();
  const existing = v.id ? all.find((p) => p.id === v.id) : undefined;
  const post: BlogPostRecord = {
    id: v.id ?? randomUUID(),
    slug: v.slug,
    locale: v.locale,
    title: v.title,
    excerpt: v.excerpt,
    bodyMd: v.bodyMd,
    status: v.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    publishedAt: v.status === "published" ? (existing?.publishedAt ?? now) : (existing?.publishedAt ?? null),
  };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const row = await db.blogPost.upsert({
        where: { id: post.id },
        create: {
          id: post.id, slug: post.slug, locale: post.locale, title: post.title,
          excerpt: post.excerpt, bodyMd: post.bodyMd, status: post.status,
          publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        },
        update: {
          slug: post.slug, locale: post.locale, title: post.title, excerpt: post.excerpt,
          bodyMd: post.bodyMd, status: post.status,
          publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        },
      });
      return { ok: true, post: fromRow(row), persisted: "db" };
    } catch { /* fall through — e.g. (locale, slug) collision in file store too */ }
  }
  const idx = all.findIndex((p) => p.id === post.id);
  if (idx >= 0) all[idx] = post; else all.push(post);
  await writeStore(all);
  return { ok: true, post, persisted: "file" };
}

export async function deleteBlogPost(id: string): Promise<{ ok: boolean }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.blogPost.delete({ where: { id } });
      return { ok: true };
    } catch { /* fall through */ }
  }
  const all = await readStore();
  const next = all.filter((p) => p.id !== id);
  if (next.length === all.length) return { ok: false };
  await writeStore(next);
  return { ok: true };
}
