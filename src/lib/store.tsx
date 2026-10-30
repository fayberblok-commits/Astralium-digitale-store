"use client";
/**
 * Client-side store: cart (one license per product — duplicates are
 * impossible), wishlist and on-device order records, persisted in
 * localStorage. A future accounts phase syncs these to the server data
 * layer; the interfaces stay the same.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ready, setReady] = useState(false);

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

  const value: StoreState = {
    cart, wishlist, orders, add, remove, clear, inCart, toggleWish, wished, saveOrder, markPaid, subtotal,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
