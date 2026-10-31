"use client";
import { useEffect } from "react";

/**
 * Scroll-reveal driver (Phase 2 upgrade). Elements carrying
 * [data-reveal] start hidden ONLY when html.js is present (the inline
 * theme script adds it), so no-JS visitors always see everything.
 * Reduced-motion / owner motion-off → everything is revealed at once.
 * A safety timer reveals anything the observer somehow missed.
 */
export default function ScrollReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (els.length === 0) return;
    const reduced =
      document.documentElement.dataset.motion === "off" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window);
    if (reduced) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -4% 0px" },
    );
    els.forEach((el) => io.observe(el));
    const safety = window.setTimeout(() => els.forEach((el) => el.classList.add("in")), 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(safety);
    };
  }, []);
  return null;
}
