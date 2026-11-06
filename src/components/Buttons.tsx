"use client";
import { useRouter } from "next/navigation";
import { useStore, type CartItem } from "../lib/store";

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
            add(item);
            router.push(`/${locale}/checkout`);
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
 * approved mockups. It is NOT a separate payment path: it adds the
 * item, records a provider *preference* the checkout reads on mount
 * (PayPal stays the selected method there), and routes to the regular
 * checkout — the exact same /api/checkout flow as Buy Now. Rendered
 * by server components ONLY when PayPal is actually configured, the
 * same rule as every other express affordance in this codebase.
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
  const { add } = useStore();
  const router = useRouter();
  return (
    <button
      type="button"
      className={`btn-paypal-brand ${big ? "btn-paypal-lg" : ""}`}
      onClick={() => {
        add(item);
        try {
          sessionStorage.setItem("astralium-provider", "paypal");
        } catch { /* preference is best-effort */ }
        router.push(`/${locale}/checkout`);
      }}
    >
      Pay<span className="pp-alt">Pal</span>
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
