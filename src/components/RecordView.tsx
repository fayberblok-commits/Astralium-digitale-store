"use client";
/** Records a product view in on-device history (slugs only, no PII) for
 * the "similar to what you viewed" recommendation signal. Phase 6: also
 * fires the first-party analytics product_view when the beacon is on. */
import { useEffect } from "react";
import { track } from "../lib/track-client";

export default function RecordView({ slug, productId }: { slug: string; productId?: string }) {
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("astralium-viewed") ?? "[]") as string[];
      const next = [slug, ...raw.filter((s) => s !== slug)].slice(0, 20);
      localStorage.setItem("astralium-viewed", JSON.stringify(next));
    } catch { /* private mode — signal is optional */ }
    track("product_view", productId ? { productId } : undefined);
  }, [slug, productId]);
  return null;
}
