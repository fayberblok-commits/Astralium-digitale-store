"use client";
import Link from "next/link";
import { useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { useStore } from "../lib/store";
import { formatPrice } from "../lib/currency";
import { priceCart } from "../lib/coupons";

export default function CartClient({ locale, dict, currency }: { locale: string; dict: Dict; currency: string }) {
  const { cart, remove, subtotal } = useStore();
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState(0);
  const [couponMsg, setCouponMsg] = useState<"ok" | "bad" | null>(null);
  const totals = priceCart(subtotal, discount);

  async function applyCoupon() {
    if (!code.trim()) return;
    try {
      const res = await fetch("/api/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, subtotalUSD: subtotal, isFirstOrder: true }),
      });
      const data = (await res.json()) as { ok: boolean; discountUSD?: number };
      if (data.ok) {
        setDiscount(data.discountUSD ?? 0);
        setCouponMsg("ok");
        sessionStorage.setItem("astralium-coupon", JSON.stringify({ code, discountUSD: data.discountUSD ?? 0 }));
      } else {
        setDiscount(0);
        setCouponMsg("bad");
      }
    } catch {
      setCouponMsg("bad");
    }
  }

  if (cart.length === 0) {
    return (
      <div className="panel" style={{ marginTop: 28, textAlign: "center" }}>
        <p>{dict.cart_empty}</p>
        <Link href={`/${locale}/shop`} className="btn btn-primary">{dict.continue_shopping}</Link>
      </div>
    );
  }

  return (
    <div className="two-col">
      <div className="panel">
        {cart.map((item) => (
          <div key={item.id} className="cart-line">
            <span aria-hidden="true" style={{ fontSize: "1.4rem" }}>✦</span>
            <span className="grow">
              <strong>{item.title}</strong>
              <br />
              <span className="muted">{item.kind === "bundle" ? "Bundle" : "1 × license"}</span>
            </span>
            <strong>{formatPrice(item.priceUSD, currency, locale)}</strong>
            <button type="button" className="btn btn-ghost" onClick={() => remove(item.id)}>
              {dict.remove}
            </button>
          </div>
        ))}
      </div>
      <div className="panel">
        <div className="coupon-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={dict.coupon_ph}
            aria-label={dict.coupon_ph}
          />
          <button type="button" className="btn" onClick={applyCoupon}>{dict.coupon_apply}</button>
        </div>
        {couponMsg === "ok" && <p className="ok-text" role="status">{dict.coupon_ok}</p>}
        {couponMsg === "bad" && <p className="err-text" role="alert">{dict.coupon_bad}</p>}
        <p className="summary-row"><span>{dict.cart_subtotal}</span><span>{formatPrice(totals.subtotal, currency, locale)}</span></p>
        {totals.discount > 0 && (
          <p className="summary-row"><span>{dict.cart_discount}</span><span>−{formatPrice(totals.discount, currency, locale)}</span></p>
        )}
        <p className="summary-row summary-total"><span>{dict.cart_total}</span><span>{formatPrice(totals.total, currency, locale)}</span></p>
        <Link href={`/${locale}/checkout`} className="btn btn-primary btn-lg" style={{ width: "100%" }}>
          {dict.go_checkout}
        </Link>
        <p className="muted">{dict.free_returns_note}</p>
      </div>
    </div>
  );
}
