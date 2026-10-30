"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/prefs-controls";
import type { LocaleCode } from "@/lib/i18n";

export type HeaderLabels = {
  home: string;
  catalog: string;
  agents: string;
  support: string;
  offers: string;
  blog: string;
  account: string;
  searchPlaceholder: string;
  search: string;
  menu: string;
  close: string;
  wishlist: string;
};

export function SiteHeader({
  locale,
  enabledLocales,
  announcement,
  labels,
  customerName,
}: {
  locale: LocaleCode;
  enabledLocales: string[];
  announcement: string;
  labels: HeaderLabels;
  customerName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const nav = [
    { href: "/", label: labels.home },
    { href: "/catalog", label: labels.catalog },
    { href: "/agents", label: labels.agents },
    { href: "/offers", label: labels.offers },
    { href: "/support", label: labels.support },
    { href: "/blog", label: labels.blog },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-[rgba(217,178,106,0.14)] bg-[rgba(5,6,15,0.82)] backdrop-blur-xl">
      <div className="border-b border-[rgba(217,178,106,0.1)] bg-gradient-to-r from-transparent via-[rgba(217,178,106,0.1)] to-transparent">
        <p className="mx-auto max-w-7xl px-4 py-1.5 text-center text-[10px] tracking-[0.14em] text-[#e3d3ac] sm:text-[11px]">
          {announcement}
        </p>
      </div>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Astralium Digitale Store">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(217,178,106,0.45)] bg-[radial-gradient(circle_at_30%_25%,rgba(240,220,174,0.35),rgba(5,6,15,0.9))]">
            <span className="font-display text-lg text-[#f0dcae]">✦</span>
            <span className="absolute inset-0 rounded-full border border-[rgba(217,178,106,0.2)]" />
          </span>
          <span className="leading-none">
            <span className="block font-display text-[17px] tracking-[0.24em] text-[#f6f1e3]">ASTRALIUM</span>
            <span className="mt-1 block text-[8.5px] uppercase tracking-[0.42em] text-[#b8a883]">Digitale Store</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
          {nav.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-3 py-2 text-[13px] transition ${
                  active ? "bg-[rgba(217,178,106,0.14)] text-[#f8eccd]" : "text-[#c3bed0] hover:text-[#f0dcae]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <form action="/catalog" className="hidden items-center md:flex">
            <label className="sr-only" htmlFor="nav-search">
              {labels.search}
            </label>
            <input
              id="nav-search"
              name="q"
              type="search"
              placeholder={labels.searchPlaceholder}
              className="w-36 rounded-full border border-[rgba(217,178,106,0.22)] bg-[#080a17]/80 px-3 py-1.5 text-[11px] text-[#f0ecdf] placeholder:text-[#7f7b90] xl:w-52"
            />
          </form>
          <LanguageSwitcher locale={locale} enabled={enabledLocales} compact />
          <Link
            href="/wishlist"
            aria-label={labels.wishlist}
            className="hidden h-8 w-8 items-center justify-center rounded-full border border-[rgba(217,178,106,0.22)] text-[#eeddb5] transition hover:bg-[rgba(217,178,106,0.12)] sm:flex"
          >
            ★
          </Link>
          <Link
            href={customerName ? "/account" : "/account/login"}
            className="hidden items-center gap-1.5 rounded-full border border-[rgba(217,178,106,0.32)] bg-[rgba(217,178,106,0.08)] px-3 py-1.5 text-[11.5px] text-[#f0dcae] transition hover:bg-[rgba(217,178,106,0.16)] sm:flex"
          >
            <span aria-hidden="true">◐</span>
            <span className="max-w-24 truncate">{customerName || labels.account}</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? labels.close : labels.menu}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(217,178,106,0.3)] text-[#f0dcae] lg:hidden"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-[rgba(217,178,106,0.14)] bg-[#060815] px-4 pb-5 pt-3 lg:hidden">
          <form action="/catalog" className="mb-3 flex gap-2">
            <input
              name="q"
              type="search"
              placeholder={labels.searchPlaceholder}
              className="field"
              aria-label={labels.search}
            />
            <button type="submit" className="btn-gold whitespace-nowrap px-4 text-xs">
              {labels.search}
            </button>
          </form>
          <div className="grid grid-cols-2 gap-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-[rgba(217,178,106,0.16)] bg-white/[0.03] px-3 py-2.5 text-sm text-[#e9e4d8]"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={customerName ? "/account" : "/account/login"}
              onClick={() => setOpen(false)}
              className="rounded-xl border border-[rgba(217,178,106,0.16)] bg-white/[0.03] px-3 py-2.5 text-sm text-[#e9e4d8]"
            >
              {customerName || labels.account}
            </Link>
            <Link
              href="/wishlist"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-[rgba(217,178,106,0.16)] bg-white/[0.03] px-3 py-2.5 text-sm text-[#e9e4d8]"
            >
              {labels.wishlist}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
