"use client";
/**
 * Client-side store: cart (one license per product — duplicates are
 * impossible), wishlist and on-device order records, persisted in
 * localStorage. A future accounts phase syncs these to the server data
 * layer; the interfaces stay the same.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface CartItem {
  id: string; // product id or bundle id
  kind: "product" | "bundle";
  slug: string;
  title: string;
  priceUSD: number;
  hue: number;
  productIds?: string[]; // for bundles: everything the order fulfils
}

export interface OrderRecord {
  orderId: string;
  email: string;
  items: CartItem[];
  totalUSD: number;
  discountUSD: number;
  coupon?: string;
  provider: string;
  /** provider reference (e.g. Stripe session id) used to re-verify payment */
  providerRef?: string;
  createdAt: string;
  status: "initiated" | "paid";
}

interface StoreState {
  cart: CartItem[];
  wishlist: string[]; // product slugs
  orders: OrderRecord[];
  add: (item: CartItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  inCart: (id: string) => boolean;
  toggleWish: (slug: string) => void;
  wished: (slug: string) => boolean;
  saveOrder: (order: OrderRecord) => void;
  markPaid: (orderId: string) => void;
  subtotal: number;
  /** Titles of cart items the last catalog sync pruned as unavailable. */
  prunedTitles: string[];
  dismissPruned: () => void;
  /**
   * Reconcile the cart snapshot with the live catalog (thermal fix):
   * refreshes title/price/slug/hue of surviving items and prunes items
   * that are no longer available, recording their titles in
   * `prunedTitles` so the page can say what happened. Fail-open: a
   * network hiccup leaves the cart untouched (the checkout API still
   * re-validates server-side). Safe to call repeatedly — it re-runs
   * only when the cart's id set actually changes.
   */
  syncCartWithCatalog: () => Promise<void>;
}

const Ctx = createContext<StoreState | null>(null);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

interface AvailabilityEntry {
  available: boolean;
  kind?: "product" | "bundle";
  title?: string;
  slug?: string;
  priceUSD?: number;
  hue?: number;
  productIds?: string[];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [prunedTitles, setPrunedTitles] = useState<string[]>([]);
  const cartRef = useRef<CartItem[]>([]);
  cartRef.current = cart;
  const lastSyncKey = useRef<string>("");

  useEffect(() => {
    setCart(read("astralium-cart", []));
    setWishlist(read("astralium-wishlist", []));
    setOrders(read("astralium-orders", []));
    setReady(true);
  }, []);

  useEffect(() => { if (ready) localStorage.setItem("astralium-cart", JSON.stringify(cart)); }, [cart, ready]);
  useEffect(() => { if (ready) localStorage.setItem("astralium-wishlist", JSON.stringify(wishlist)); }, [wishlist, ready]);
  useEffect(() => { if (ready) localStorage.setItem("astralium-orders", JSON.stringify(orders)); }, [orders, ready]);

  const add = useCallback((item: CartItem) => {
    setCart((c) => (c.some((i) => i.id === item.id) ? c : [...c, item])); // one license per product
    // Phase 6, feature 27: first-party analytics (no-op unless the
    // analytics beacon is mounted, i.e. the flag is on).
    void import("./track-client").then((m) => m.track("add_to_cart", { productId: item.id })).catch(() => undefined);
  }, []);
  const remove = useCallback((id: string) => setCart((c) => c.filter((i) => i.id !== id)), []);
  const clear = useCallback(() => setCart([]), []);
  const inCart = useCallback((id: string) => cart.some((i) => i.id === id), [cart]);
  const toggleWish = useCallback((slug: string) => {
    setWishlist((w) => (w.includes(slug) ? w.filter((s) => s !== slug) : [...w, slug]));
  }, []);
  const wished = useCallback((slug: string) => wishlist.includes(slug), [wishlist]);
  const saveOrder = useCallback((order: OrderRecord) => {
    setOrders((o) => [order, ...o.filter((x) => x.orderId !== order.orderId)]);
  }, []);
  const markPaid = useCallback((orderId: string) => {
    setOrders((o) => o.map((x) => (x.orderId === orderId ? { ...x, status: "paid" as const } : x)));
  }, []);

  const subtotal = useMemo(() => Math.round(cart.reduce((s, i) => s + i.priceUSD, 0) * 100) / 100, [cart]);

  const dismissPruned = useCallback(() => setPrunedTitles([]), []);

  const syncCartWithCatalog = useCallback(async () => {
    const current = cartRef.current;
    if (current.length === 0) return;
    const key = current.map((i) => i.id).sort().join(",");
    if (key === lastSyncKey.current) return;
    lastSyncKey.current = key;
    try {
      const res = await fetch("/api/catalog/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: current.map((i) => i.id) }),
      });
      if (!res.ok) return; // fail-open: server checkout still validates
      const data = (await res.json()) as { items?: Record<string, AvailabilityEntry> };
      if (!data.items) return;
      const fresh: CartItem[] = [];
      const pruned: string[] = [];
      for (const item of cartRef.current) {
        const entry = data.items[item.id];
        if (!entry) {
          fresh.push(item); // unknown answer — keep, server decides
          continue;
        }
        if (!entry.available) {
          pruned.push(item.title);
          continue;
        }
        fresh.push({
          ...item,
          kind: entry.kind ?? item.kind,
          title: entry.title ?? item.title,
          slug: entry.slug ?? item.slug,
          priceUSD: entry.priceUSD ?? item.priceUSD,
          hue: entry.hue ?? item.hue,
          productIds: entry.productIds ?? item.productIds,
        });
      }
      if (pruned.length > 0) setPrunedTitles(pruned);
      setCart(fresh);
    } catch {
      // Fail-open by design (see interface note).
    }
  }, []);

  const value: StoreState = {
    cart, wishlist, orders, add, remove, clear, inCart, toggleWish, wished, saveOrder, markPaid, subtotal,
    prunedTitles, dismissPruned, syncCartWithCatalog,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
