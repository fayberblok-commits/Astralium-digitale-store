"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Main navigation with the animated section indicator (Phase 2
 * upgrade). The active link is derived from the pathname; its
 * underline is a palette-gradient bar that scales in, and its colour
 * therefore follows whichever palette the owner activates.
 */
export default function NavLinks({
  locale,
  labels,
  showBlog = false,
}: {
  locale: string;
  labels: { home: string; shop: string; blog: string; account: string };
  showBlog?: boolean;
}) {
  const pathname = usePathname() || `/${locale}`;
  const rest = pathname.replace(new RegExp(`^/${locale}(/|$)`), "/");
  const section = rest === "/" ? "home" : rest.split("/")[1] || "home";
  const items: Array<{ key: string; href: string; label: string; match: string }> = [
    { key: "home", href: `/${locale}`, label: labels.home, match: "home" },
    { key: "shop", href: `/${locale}/shop`, label: labels.shop, match: "shop" },
    ...(showBlog ? [{ key: "blog", href: `/${locale}/blog`, label: labels.blog, match: "blog" }] : []),
    { key: "account", href: `/${locale}/account`, label: labels.account, match: "account" },
  ];
  // Product pages belong to the shop section.
  const activeKey = section === "product" ? "shop" : section;
  return (
    <nav className="main-nav" aria-label="Main">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={item.match === activeKey ? "nav-active" : undefined}
          aria-current={item.match === activeKey ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
