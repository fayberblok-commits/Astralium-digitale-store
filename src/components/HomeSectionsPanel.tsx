"use client";
/**
 * Homepage sections control (Phase 3 upgrade) — the minimal but
 * functional admin UI over /api/admin/home-sections: reorder with
 * up/down buttons, toggle visibility, save. The full design office
 * (Phase 4) will build on the same API.
 */
import { useEffect, useState } from "react";

export interface HomeSectionsLabels {
  up: string;
  down: string;
  visible: string;
  save: string;
  saved: string;
  names: Record<string, string>;
}

interface LayoutState {
  order: string[];
  hidden: string[];
}

export default function HomeSectionsPanel({ dict }: { dict: HomeSectionsLabels }) {
  const [layout, setLayout] = useState<LayoutState | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/home-sections");
        if (res.ok) {
          const data = (await res.json()) as { settings: LayoutState };
          setLayout(data.settings);
        }
      } catch { /* panel stays in its loading state */ }
    })();
  }, []);

  function move(index: number, dir: -1 | 1) {
    setSaved(false);
    setLayout((cur) => {
      if (!cur) return cur;
      const order = [...cur.order];
      const j = index + dir;
      if (j < 0 || j >= order.length) return cur;
      [order[index], order[j]] = [order[j], order[index]];
      return { ...cur, order };
    });
  }

  function toggleHidden(id: string, visible: boolean) {
    setSaved(false);
    setLayout((cur) => {
      if (!cur) return cur;
      const hidden = visible ? cur.hidden.filter((h) => h !== id) : [...cur.hidden, id];
      return { ...cur, hidden };
    });
  }

  async function save() {
    if (!layout) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/admin/home-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      if (!res.ok) throw new Error("save failed");
      const data = (await res.json()) as { settings: LayoutState };
      setLayout(data.settings);
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!layout) return <p className="muted">…</p>;

  return (
    <div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {layout.order.map((id, i) => {
          const visible = !layout.hidden.includes(id);
          return (
            <li
              key={id}
              style={{
                display: "flex", gap: 10, alignItems: "center", padding: "8px 4px",
                borderBottom: "1px solid var(--line)", opacity: visible ? 1 : 0.55,
              }}
            >
              <span style={{ flex: 1, fontWeight: 600 }}>{dict.names[id] ?? id}</span>
              <button type="button" className="btn btn-ghost" aria-label={dict.up} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-ghost" aria-label={dict.down} disabled={i === layout.order.length - 1} onClick={() => move(i, 1)}>↓</button>
              <label className="theme-radio">
                <input type="checkbox" checked={visible} onChange={(e) => toggleHidden(id, e.target.checked)} />
                {dict.visible}
              </label>
            </li>
          );
        })}
      </ol>
      <p style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 0 }}>
        <button type="button" className="btn btn-primary" disabled={busy} data-loading={busy || undefined} onClick={save}>
          {dict.save}
        </button>
        {saved && <span className="ok-text" role="status">{dict.saved}</span>}
        {failed && <span className="err-text" role="alert">✗</span>}
      </p>
    </div>
  );
}
