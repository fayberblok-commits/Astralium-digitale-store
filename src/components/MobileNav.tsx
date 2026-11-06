"use client";
/**
 * Mobile bottom navigation (Phase 3 upgrade) — thumb-reach Home /
 * Shop / Cart / Account, visible only on small screens (CSS-gated);
 * the desktop masthead nav is untouched. The active section follows
 * the pathname with the same gradient indicator language as the top
 * nav, and the cart carries the live cart count from the store.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Dict } from "../i18n/dictionaries";
import { useStore } from "../lib/store";
import { openChat } from "../lib/chat-events";

export default function MobileNav({ locale, dict }: { locale: string; dict: Dict }) {
  const pathname = usePathname() ?? "";
  const { cart } = useStore();
  const count = cart.length;
  const rest = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "") || "/";
  const section = rest.startsWith("/shop") || rest.startsWith("/product")
    ? "shop"
    : rest.startsWith("/cart") || rest.startsWith("/checkout")
      ? "cart"
      : rest.startsWith("/account")
        ? "account"
        : "home";
  const items = [
    { id: "home", href: `/${locale}`, label: dict.nav_home, icon: "✦" },
    { id: "shop", href: `/${locale}/shop`, label: dict.nav_shop, icon: "▦" },
    { id: "cart", href: `/${locale}/cart`, label: dict.nav_cart, icon: "🛒" },
    { id: "account", href: `/${locale}/account`, label: dict.nav_account, icon: "◉" },
  ] as const;
  return (
    <nav className="mobile-nav" aria-label={dict.nav_home}>
      {items.map((it) => (
        <Link
          key={it.id}
          href={it.href}
          className={`mobile-nav-item ${section === it.id ? "nav-active" : ""}`}
          aria-current={section === it.id ? "page" : undefined}
        >
          <span className="mobile-nav-icon" aria-hidden="true">
            {it.icon}
            {it.id === "cart" && count > 0 && <span className="cart-count">{count}</span>}
          </span>
          <span className="mobile-nav-label">{it.label}</span>
        </Link>
      ))}
      {/* Owner fix (2026-11): a Support entry that opens the smart
          employee (ChatWidget) — support must be reachable from the
          thumb bar on every page. It is a button, not a page link. */}
      <button type="button" className="mobile-nav-item" onClick={() => openChat()}>
        <span className="mobile-nav-icon" aria-hidden="true">✦</span>
        <span className="mobile-nav-label">{dict.nav_support}</span>
      </button>
    </nav>
  );
}
