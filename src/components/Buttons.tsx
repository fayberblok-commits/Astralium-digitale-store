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
}: {
  item: CartItem;
  locale: string;
  addLabel: string;
  inCartLabel: string;
  buyLabel?: string;
  big?: boolean;
}) {
  const { add, inCart } = useStore();
  const router = useRouter();
  const already = inCart(item.id);
  return (
    <span className="btn-row">
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
