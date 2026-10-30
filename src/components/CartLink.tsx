"use client";
import Link from "next/link";
import { useStore } from "../lib/store";

export default function CartLink({ locale, label }: { locale: string; label: string }) {
  const { cart } = useStore();
  return (
    <Link href={`/${locale}/cart`} className="cart-link" aria-label={label}>
      🛒
      {cart.length > 0 && <span className="cart-count">{cart.length}</span>}
    </Link>
  );
}
