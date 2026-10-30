"use client";
/**
 * Cart recovery applier (Phase 5, feature 20). When the cart page is
 * opened with ?recover=<token> (the signed link from the recovery
 * email), the snapshot's items are restored into the local cart and a
 * confirmation note is shown. The token is resolved server-side; an
 * invalid/expired link simply does nothing.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { useStore } from "../lib/store";

export default function CartRecover({ dict }: { dict: Dict }) {
  const { add } = useStore();
  const [done, setDone] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("recover");
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/cart/recover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          items: { id: string; kind: "product"; slug: string; title: string; priceUSD: number; hue: number }[];
        };
        if (cancelled) return;
        for (const item of data.items) add(item);
        setDone(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("recover");
        window.history.replaceState(null, "", url.toString());
      } catch { /* a bad link must never break the cart page */ }
    })();
    return () => { cancelled = true; };
  }, [add]);

  if (!done) return null;
  return (
    <p className="panel" role="status" style={{ marginTop: 16 }}>
      ✓ {dict.cart_recovered}
    </p>
  );
}
