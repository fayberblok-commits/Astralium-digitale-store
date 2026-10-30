"use client";

import { useEffect, useState } from "react";

const KEY = "astralium_wishlist_v1";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function useWishlist() {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    setItems(read());
    const onChange = () => setItems(read());
    window.addEventListener("astralium:wishlist", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("astralium:wishlist", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  function toggle(slug: string) {
    const current = read();
    const next = current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug];
    window.localStorage.setItem(KEY, JSON.stringify(next));
    setItems(next);
    window.dispatchEvent(new Event("astralium:wishlist"));
  }

  return { items, toggle };
}

export function WishlistButton({ slug, label, compact = false }: { slug: string; label: string; compact?: boolean }) {
  const { items, toggle } = useWishlist();
  const active = items.includes(slug);
  return (
    <button
      type="button"
      onClick={() => toggle(slug)}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border transition ${
        active
          ? "border-[rgba(217,178,106,0.7)] bg-[rgba(217,178,106,0.2)] text-[#fff3d3]"
          : "border-white/10 bg-white/5 text-[#cfc9d8] hover:border-[rgba(217,178,106,0.45)] hover:text-[#f0dcae]"
      } ${compact ? "h-7 w-7 text-[11px]" : "px-4 py-2 text-sm"}`}
    >
      <span aria-hidden="true">{active ? "★" : "☆"}</span>
      {compact ? null : <span>{active ? label : label}</span>}
    </button>
  );
}
