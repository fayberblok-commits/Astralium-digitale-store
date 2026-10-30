"use client";
/** Admin blog editor (Phase 5, feature 21). Draft by default. */
import { useCallback, useEffect, useState } from "react";

export interface BlogDict {
  save: string; saved: string; delete: string; status: string; locale: string;
  slug: string; body: string; excerpt: string; newPost: string; title: string;
  published: string; draft: string; empty: string; edit: string;
}

interface Post {
  id: string; slug: string; locale: string; title: string; excerpt: string;
  bodyMd: string; status: string; updatedAt: string;
}

const EMPTY = { id: "", slug: "", locale: "en", title: "", excerpt: "", bodyMd: "", status: "draft" };

export default function BlogManager({ locales, dict }: { locales: string[]; dict: BlogDict }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/blog");
      if (!res.ok) return;
      const data = (await res.json()) as { posts: Post[] };
      setPosts(data.posts);
    } catch { /* empty state renders */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const res = await fetch("/api/admin/blog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const data = (await res.json()) as { post: Post };
      setForm({ ...data.post });
      setSaved(true);
      void load();
    }
  }

  async function remove(id: string) {
    await fetch(`/api/admin/blog?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (form.id === id) setForm({ ...EMPTY });
    void load();
  }

  return (
    <div>
      <p>
        <button type="button" className="btn" onClick={() => setForm({ ...EMPTY })}>{dict.newPost}</button>
      </p>
      <label>
        {dict.title}
        <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ width: "100%" }} />
      </label>
      <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label>
          {dict.slug}
          <input type="text" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </label>
        <label>
          {dict.locale}
          <select value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })}>
            {locales.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>
          {dict.status}
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="draft">{dict.draft}</option>
            <option value="published">{dict.published}</option>
          </select>
        </label>
      </p>
      <label>
        {dict.excerpt}
        <input type="text" value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} style={{ width: "100%" }} />
      </label>
      <label>
        {dict.body} (Markdown)
        <textarea value={form.bodyMd} onChange={(e) => setForm({ ...form, bodyMd: e.target.value })} rows={12} style={{ width: "100%" }} />
      </label>
      <p>
        <button type="button" className="btn btn-primary" onClick={() => void save()}>{dict.save}</button>
        {saved ? <span className="ok-text"> ✓ {dict.saved}</span> : null}
      </p>

      {posts.length === 0 ? (
        <p className="empty-note">{dict.empty}</p>
      ) : (
        <table className="admin-table">
          <thead><tr><th>{dict.title}</th><th>{dict.locale}</th><th>{dict.status}</th><th></th></tr></thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td>{p.title}</td>
                <td>{p.locale}</td>
                <td>{p.status === "published" ? <span className="pill pill-ok">{dict.published}</span> : <span className="pill pill-bad">{dict.draft}</span>}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...p })}>{dict.edit}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void remove(p.id)}>{dict.delete}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
