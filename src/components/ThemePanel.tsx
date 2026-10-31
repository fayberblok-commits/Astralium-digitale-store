"use client";
/**
 * Admin "Storefront theme" panel (Phase 2 upgrade).
 *
 * Palette cards render a miniature storefront mock in each palette's
 * own tokens. Clicking a card previews it LIVE on the whole page: the
 * panel injects that palette's token stylesheet (same generator the
 * layout uses — lib/themes paletteCss) and flips data-palette, so
 * what the owner sees is exactly what visitors will get. Leaving
 * without saving restores the saved theme; Save persists server-side
 * (DB Setting or .data/theme.json) and is audit-logged by the API.
 */
import { useEffect, useRef, useState } from "react";
import { PALETTES, contrastReport, getPalette, paletteCss, type Palette } from "../lib/themes";

export interface ThemeDict {
  palette: string;
  mode: string;
  modeLight: string;
  modeDark: string;
  modeSystem: string;
  motion: string;
  motionHint: string;
  save: string;
  saved: string;
  preview: string;
  active: string;
  contrast: string;
  contrastPass: string;
  names: Record<string, string>;
}

type Mode = "light" | "dark" | "system";
interface Settings { palette: string; mode: Mode; motion: boolean }

const PREVIEW_STYLE_ID = "astralium-theme-preview";

function applyPreview(paletteId: string) {
  const doc = document.documentElement;
  doc.dataset.palette = paletteId;
  let el = document.getElementById(PREVIEW_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = PREVIEW_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = paletteCss(getPalette(paletteId));
}

function clearPreview() {
  document.getElementById(PREVIEW_STYLE_ID)?.remove();
}

function MiniMock({ palette }: { palette: Palette }) {
  const m = palette.light;
  const vars = {
    "--bg": m.bg, "--bg-2": m.bg2, "--surface-strong": m.surfaceStrong,
    "--text": m.text, "--muted": m.muted, "--gold": m.accent, "--gold-ink": m.accentInk,
    "--grad-1": palette.grad[0], "--grad-2": palette.grad[1],
    "--grad-3": palette.grad[2], "--grad-4": palette.grad[3], "--on-grad": palette.onGrad,
  } as React.CSSProperties;
  return (
    <div className="theme-mock" style={vars} aria-hidden="true">
      <div className="theme-mock-bar">
        <span className="theme-mock-star">✦</span>
        <span className="theme-mock-line" style={{ width: "34%" }} />
        <span className="theme-mock-line" style={{ width: "22%" }} />
      </div>
      <div className="theme-mock-title">Astralium</div>
      <div className="theme-mock-text" />
      <div className="theme-mock-text" style={{ width: "64%" }} />
      <span className="theme-mock-btn">✦</span>
    </div>
  );
}

export default function ThemePanel({ dict }: { dict: ThemeDict }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pick, setPick] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const original = useRef<{ palette?: string; theme?: string; motion?: string } | null>(null);

  useEffect(() => {
    const doc = document.documentElement;
    original.current = { palette: doc.dataset.palette, theme: doc.dataset.theme, motion: doc.dataset.motion };
    void (async () => {
      try {
        const res = await fetch("/api/admin/theme");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { settings: Settings };
        setSettings(data.settings);
        setPick(data.settings);
      } catch {
        setError("theme load failed");
      }
    })();
    return () => {
      // Leaving without an explicit save restores the saved look.
      clearPreview();
      const docEl = document.documentElement;
      const o = original.current;
      if (o) {
        if (o.palette) docEl.dataset.palette = o.palette; else delete docEl.dataset.palette;
        if (o.theme) docEl.dataset.theme = o.theme;
        if (o.motion) docEl.dataset.motion = o.motion; else delete docEl.dataset.motion;
      }
    };
  }, []);

  function preview(next: Settings) {
    setPick(next);
    setSavedNote(false);
    applyPreview(next.palette);
    document.documentElement.dataset.motion = next.motion ? "on" : "off";
    if (next.mode === "light" || next.mode === "dark") {
      document.documentElement.dataset.theme = next.mode;
    }
  }

  async function save() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pick),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { settings: Settings };
      setSettings(data.settings);
      setPick(data.settings);
      original.current = {
        palette: data.settings.palette,
        theme: document.documentElement.dataset.theme,
        motion: data.settings.motion ? "on" : "off",
      };
      setSavedNote(true);
    } catch {
      setError("theme save failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <p className="pill pill-bad">{error}</p>;
  if (!settings || !pick) return <p className="muted">…</p>;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>{dict.preview}</p>
      <div className="theme-grid">
        {PALETTES.map((p) => {
          const checks = [...contrastReport(p, "light"), ...contrastReport(p, "dark")];
          const worst = Math.min(...checks.map((c) => c.ratio));
          const allPass = checks.every((c) => c.pass);
          const isPicked = pick.palette === p.id;
          const isActive = settings.palette === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`theme-card${isPicked ? " theme-card-picked" : ""}`}
              onClick={() => preview({ ...pick, palette: p.id })}
              aria-pressed={isPicked}
            >
              <MiniMock palette={p} />
              <span className="theme-card-name">
                {dict.names[p.id] ?? p.id}
                {isActive ? <span className="pill pill-ok">{dict.active}</span> : null}
              </span>
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {dict.contrast}: {allPass ? `${dict.contrastPass} · ≥${worst.toFixed(1)}:1` : "✗"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="theme-controls">
        <fieldset className="theme-fieldset">
          <legend>{dict.mode}</legend>
          {(["system", "light", "dark"] as Mode[]).map((m) => (
            <label key={m} className="theme-radio">
              <input
                type="radio"
                name="theme-mode"
                checked={pick.mode === m}
                onChange={() => preview({ ...pick, mode: m })}
              />
              {m === "light" ? dict.modeLight : m === "dark" ? dict.modeDark : dict.modeSystem}
            </label>
          ))}
        </fieldset>
        <label className="theme-radio">
          <input
            type="checkbox"
            checked={pick.motion}
            onChange={(e) => preview({ ...pick, motion: e.target.checked })}
          />
          {dict.motion}
        </label>
        <p className="muted" style={{ margin: 0 }}>{dict.motionHint}</p>
      </div>

      <p style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {dict.save}
        </button>{" "}
        {savedNote ? <span className="pill pill-ok">{dict.saved}</span> : null}
        {error ? <span className="pill pill-bad">{error}</span> : null}
      </p>
    </div>
  );
}
