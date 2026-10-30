"use client";
/**
 * My Library (Phase 3, feature 1): posts the device's own order records
 * to /api/library, which re-mints fresh signed download tokens and
 * computes version/update state server-side. Hides when the library
 * flag is off (403).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Dict } from "../i18n/dictionaries";
import { useStore } from "../lib/store";

interface Entry {
  orderId: string;
  productId: string;
  slug: string;
  title: string;
  purchasedVersion: string;
  latestVersion: string;
  updated: boolean;
  downloadUrl: string;
}

export default function LibrarySection({ locale, dict }: { locale: string; dict: Dict }) {
  const { orders } = useStore();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  // Phase 4: loyalty balance (feature 11) + receipt downloads (feature 16)
  const [loyalty, setLoyalty] = useState<{ balance: number; tier: string } | null>(null);

  useEffect(() => {
    if (orders.length === 0) { setEntries([]); return; }
    void (async () => {
      try {
        const res = await fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: orders[0]?.email,
            localOrders: orders.map((o) => ({
              orderId: o.orderId, createdAt: o.createdAt, status: o.status,
              items: o.items.map((i) => ({ id: i.id, productIds: i.productIds })),
            })),
          }),
        });
        if (res.status === 403) { setEnabled(false); return; }
        if (!res.ok) { setEntries([]); return; }
        const data = (await res.json()) as { entries: Entry[]; loyalty: { balance: number; tier: string } | null };
        setEntries(data.entries);
        setLoyalty(data.loyalty ?? null);
      } catch { setEntries([]); }
    })();
  }, [orders]);

  async function downloadReceipt(orderId: string) {
    const order = orders.find((o) => o.orderId === orderId);
    if (!order) return;
    try {
      const res = await fetch(`/api/receipt/${encodeURIComponent(orderId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          localOrder: {
            orderId: order.orderId, email: order.email, status: order.status,
            items: order.items.map((i) => ({ id: i.id, productIds: i.productIds })),
          },
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `astralium-receipt-${orderId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* receipt download is best-effort */ }
  }

  if (!enabled) return null;
  const anyUpdated = entries?.some((e) => e.updated);
  return (
    <section className="section" style={{ marginTop: 24 }}>
      <h2>{dict.library_t}</h2>
      {loyalty && (
        <p>
          <span className="pill pill-ok">✦ {dict.loyalty_t}: {loyalty.balance} {dict.loyalty_points_unit} · {dict.loyalty_tier_label} {loyalty.tier}</span>
        </p>
      )}
      {anyUpdated && <p className="ok-text" role="status">✦ {dict.library_notice}</p>}
      {entries === null ? (
        <p className="muted">…</p>
      ) : entries.length === 0 ? (
        <p className="empty-note">{dict.library_empty}</p>
      ) : (
        entries.map((e) => (
          <div key={`${e.orderId}-${e.productId}`} className="panel" style={{ marginBottom: 12 }}>
            <p style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{e.title}</strong>
              <span className="pill">{dict.library_version} {e.latestVersion}</span>
              {e.updated && <span className="pill pill-ok">{dict.library_updated} · v{e.latestVersion}</span>}
            </p>
            <p style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <a href={e.downloadUrl} className="btn btn-primary">{dict.download_btn}</a>
              <Link href={`/${locale}/product/${e.slug}`} className="btn btn-ghost">{dict.view_product}</Link>
              <button type="button" className="btn btn-ghost" onClick={() => downloadReceipt(e.orderId)}>
                🧾 {dict.receipt_download}
              </button>
              <span className="muted">{e.orderId}</span>
            </p>
          </div>
        ))
      )}
    </section>
  );
}
