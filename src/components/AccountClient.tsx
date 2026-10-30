"use client";
import Link from "next/link";
import type { Dict } from "../i18n/dictionaries";
import { useStore } from "../lib/store";
import { PRODUCTS, getProductBySlug } from "../data/products";
import ProductCard from "./ProductCard";
import LibrarySection from "./LibrarySection";
import WishlistExtras from "./WishlistExtras";
import ReferralPanel from "./ReferralPanel";

export default function AccountClient({ locale, dict, currency }: { locale: string; dict: Dict; currency: string }) {
  const { orders, wishlist } = useStore();
  const wishedProducts = PRODUCTS.filter((p) => wishlist.includes(p.slug));
  return (
    <>
      <p className="muted">{dict.account_d}</p>
      <section className="section" style={{ marginTop: 24 }}>
        <h2>{dict.orders_t}</h2>
        {orders.length === 0 ? (
          <p className="empty-note">{dict.orders_empty}</p>
        ) : (
          orders.map((o) => (
            <div key={o.orderId} className="panel" style={{ marginBottom: 14 }}>
              <p>
                <strong>{o.orderId}</strong> · {new Date(o.createdAt).toLocaleDateString(locale)} ·{" "}
                <span className={`pill ${o.status === "paid" ? "pill-ok" : "pill-bad"}`}>{o.status}</span>
              </p>
              <ul className="includes">
                {o.items.flatMap((item) =>
                  (item.productIds ?? [item.id]).map((pid) => {
                    const product = PRODUCTS.find((p) => p.id === pid);
                    return (
                      <li key={`${o.orderId}-${pid}`}>
                        {product ? product.title : item.title}
                        {product && (o.status === "paid" || o.providerRef) && (
                          <>
                            {" — "}
                            <Link href={`/${locale}/success?session_id=${o.providerRef ?? ""}&order=${o.orderId}`}>
                              {dict.download_btn}
                            </Link>
                          </>
                        )}
                      </li>
                    );
                  }),
                )}
              </ul>
              <p className="muted">{dict.account_note_email}</p>
            </div>
          ))
        )}
      </section>
      <LibrarySection locale={locale} dict={dict} />
      <ReferralPanel locale={locale} dict={dict} currency={currency} />
      <section className="section">
        <h2>{dict.wishlist_t}</h2>
        {wishedProducts.length === 0 ? (
          <p className="empty-note">{dict.wishlist_empty}</p>
        ) : (
          <>
            <div className="grid">
              {wishedProducts.map((p) => (
                <ProductCard key={p.id} product={getProductBySlug(p.slug)!} locale={locale} dict={dict} currency={currency} />
              ))}
            </div>
            <WishlistExtras locale={locale} dict={dict} wishlistSlugs={wishlist} />
          </>
        )}
      </section>
    </>
  );
}
