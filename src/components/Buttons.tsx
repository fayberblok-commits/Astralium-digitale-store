"use client";
import { useRouter } from "next/navigation";
import { useStore, type CartItem } from "../lib/store";
import { expressCheckoutHref } from "../lib/express";

export function AddToCartButton({
  item,
  locale,
  addLabel,
  inCartLabel,
  buyLabel,
  big = false,
  stack = false,
}: {
  item: CartItem;
  locale: string;
  addLabel: string;
  inCartLabel: string;
  buyLabel?: string;
  big?: boolean;
  /** 2026-11 redesign: vertical full-width actions (featured band). */
  stack?: boolean;
}) {
  const { add, inCart } = useStore();
  const router = useRouter();
  const already = inCart(item.id);
  return (
    <span className={stack ? "btn-col" : "btn-row"}>
      <button
        type="button"
        className={`btn ${big ? "btn-lg" : ""} btn-ghost`}
        disabled={already}
        onClick={() => add(item)}
      >
        {already ? `✓ ${inCartLabel}` : addLabel}
      </button>
      {buyLabel && (
        <button
          type="button"
          className={`btn ${big ? "btn-lg" : ""} btn-grad`}
          onClick={() => {
            // Owner fix (2026-11): BUY NOW is an EXPRESS purchase —
            // straight to a checkout containing ONLY this item. The
            // cart is deliberately NOT touched (no add): whatever the
            // customer already had in it stays exactly as it was.
            router.push(expressCheckoutHref(locale, item.id));
          }}
        >
          {buyLabel}
        </button>
      )}
    </span>
  );
}

/**
 * 2026-11 redesign: the PayPal-branded express button from the
 * approved mockups. It is NOT a separate payment path: it records a
 * provider *preference* the checkout reads on mount (PayPal stays
 * the selected method there) and routes to the EXPRESS checkout for
 * this item only — same /api/checkout flow as Buy Now. Like Buy Now
 * it never touches the cart (owner fix, 2026-11). Rendered by server
 * components ONLY when PayPal is actually configured, the same rule
 * as every other express affordance in this codebase.
 */
export function ExpressPayPalButton({
  item,
  locale,
  big = false,
}: {
  item: CartItem;
  locale: string;
  big?: boolean;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={`btn-paypal-brand ${big ? "btn-paypal-lg" : ""}`}
      onClick={() => {
        try {
          sessionStorage.setItem("astralium-provider", "paypal");
        } catch { /* preference is best-effort */ }
        router.push(expressCheckoutHref(locale, item.id));
      }}
    >
      Pay<span className="pp-alt">Pal</span>
    </button>
  );
}

/**
 * Standalone express BUY NOW (owner fix, 2026-11) — used by the
 * product page's sticky mobile buy bar, where the pay action must
 * always be visible without the full buy panel.
 */
export function ExpressBuyButton({
  item,
  locale,
  label,
  className = "btn btn-grad",
}: {
  item: CartItem;
  locale: string;
  label: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      onClick={() => router.push(expressCheckoutHref(locale, item.id))}
    >
      {label}
    </button>
  );
}

export function WishButton({ slug, label }: { slug: string; label: string }) {
  const { toggleWish, wished } = useStore();
  const active = wished(slug);
  return (
    <button
      type="button"
      className={`icon-btn wish ${active ? "active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      onClick={() => toggleWish(slug)}
    >
      {active ? "♥" : "♡"}
    </button>
  );
}
