"use client";
/**
 * Desktop-only 3D tilt wrapper (Phase 3 upgrade).
 *
 * Pointer-fine devices only: touch pointers never engage — the
 * pointer type is checked per event, which is exact where CSS
 * hover/pointer media queries are not (touchscreen laptops, headless
 * browsers). With no mouse/pen event the CSS variables stay at their
 * 0deg defaults and the transform is the identity, so nothing on a
 * phone depends on hover. Rotation is written to CSS variables
 * consumed by .card-tilt-inner; transform-only, so it can never shift
 * layout. The global prefers-reduced-motion rule freezes the
 * transition.
 */
import { useRef, type ReactNode } from "react";

const MAX_DEG = 7;

export default function Tilt({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tilt-y", `${(x * 2 * MAX_DEG).toFixed(2)}deg`);
    el.style.setProperty("--tilt-x", `${(-y * 2 * MAX_DEG).toFixed(2)}deg`);
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  }

  return (
    <div className="card-tilt" ref={ref} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="card-tilt-inner">{children}</div>
    </div>
  );
}
