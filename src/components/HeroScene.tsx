"use client";
import { useEffect, useRef } from "react";

/**
 * Animated hero scene (Phase 2 upgrade): aurora gradient blobs, a
 * lightweight canvas starfield in the active palette's colours, and
 * floating gilt shapes — all absolutely positioned behind the hero
 * copy, so the scene can never shift layout (CLS-safe) and the
 * headline stays the LCP element.
 *
 * Degradation contract (all checked client-side, in order):
 *  - owner motion toggle off (html[data-motion="off"]) → static
 *  - prefers-reduced-motion → static
 *  - Save-Data, single-core CPU → static (aurora CSS only, also paused)
 *  - tab hidden or scene off-screen → rAF loop paused
 */

function motionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.dataset.motion === "off") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  if ((navigator.hardwareConcurrency ?? 4) < 2) return false;
  return true;
}

interface Star { x: number; y: number; r: number; phase: number; speed: number; drift: number; color: number }

export default function HeroScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !motionAllowed()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let colors = ["#d6be8c", "#ffffff", "#f4a259"];
    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      const accent = cs.getPropertyValue("--gold").trim();
      const champ = cs.getPropertyValue("--champagne").trim();
      const grad = cs.getPropertyValue("--grad-2").trim();
      colors = [champ || "#d6be8c", "#ffffff", accent || "#b08d3c", grad || "#f4a259"];
    };
    readColors();

    let stars: Star[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = false;
    let visible = true;
    let last = 0;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(90, Math.max(24, Math.floor((w * h) / 14000)));
      stars = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.9,
        drift: (Math.random() - 0.5) * 3.2,
        color: i % colors.length,
      }));
    };

    const frame = (now: number) => {
      if (!running) return;
      const t = now / 1000;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.x += s.drift * dt;
        if (s.x < -4) s.x = w + 4;
        if (s.x > w + 4) s.x = -4;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.phase + t * s.speed * 2));
        ctx.globalAlpha = tw;
        ctx.fillStyle = colors[s.color % colors.length];
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    start();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) start();
        else stop();
      },
      { threshold: 0.02 },
    );
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    const mo = new MutationObserver(readColors);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="hero-scene" aria-hidden="true">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="aurora aurora-c" />
      <canvas ref={canvasRef} className="hero-canvas" />
      <span className="hero-orb hero-orb-1" />
      <span className="hero-orb hero-orb-2" />
      <span className="hero-float hero-float-1">✦</span>
      <span className="hero-float hero-float-2">✦</span>
      <span className="hero-float hero-float-3">✧</span>
    </div>
  );
}

/** Animated counters row for the hero (real store numbers). */
export function HeroStats({
  stats,
}: {
  stats: Array<{ value: number; decimals?: number; suffix?: string; label: string }>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));
    const render = (el: HTMLElement, v: number) => {
      const decimals = Number(el.dataset.decimals || 0);
      el.textContent = v.toFixed(decimals) + (el.dataset.suffix || "");
    };
    const reduced =
      document.documentElement.dataset.motion === "off" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      els.forEach((el) => render(el, Number(el.dataset.count || 0)));
      return;
    }
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (done || !entries[0]?.isIntersecting) return;
        done = true;
        io.disconnect();
        const t0 = performance.now();
        const DURATION = 1400;
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / DURATION);
          const eased = 1 - Math.pow(1 - p, 3);
          els.forEach((el) => render(el, Number(el.dataset.count || 0) * eased));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

  return (
    <div className="hero-stats" ref={ref}>
      {stats.map((s, i) => (
        <div className="hero-stat" key={i}>
          <strong
            data-count={s.value}
            data-decimals={s.decimals ?? 0}
            data-suffix={s.suffix ?? ""}
          >
            {(s.decimals ? s.value.toFixed(s.decimals) : String(s.value)) + (s.suffix ?? "")}
          </strong>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
