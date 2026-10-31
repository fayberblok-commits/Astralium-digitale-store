"use client";

/**
 * Manager's Office — orders & customers actions (Phase 4 upgrade,
 * item 3): search/filter/paginate the ledger, per-order detail with
 * grant states, resend downloads, private notes, and refunds.
 * Refunds are the guarded path: `finance` permission + step-up
 * cookie; when the API answers STEP_UP_REQUIRED the panel shows the
 * re-auth form inline and retries once after it succeeds.
 */
import { useCallback, useEffect, useState } from "react";
import StepUpForm, { type StepUpDict } from "./StepUpForm";

export interface OrdersDict {
  loading: string; searchPh: string; allStatuses: string; detail: string; resend: string;
  resent: string; refund: string; refundFull: string; refundPartial: string; refundAmount: string;
  refundDone: string; note: string; noteSave: string; grants: string; downloadsUsed: string;
  saved: string; stepUp: StepUpDict;
}

interface OrderSummary {
  id: string; email: string; status: string; totalUSD: number; refundUSD: number;
  currency: string; provider: string; providerRef: string; country: string | null;
  locale: string | null; items: number; createdAt: string;
}
interface OrderDetail {
  order: OrderSummary & {
    items: { productId: string; priceUSD: number }[]; note: string; deliveryChannel: string | null; updatedAt: string;
  };
  grants: { id: string; productId: string; downloadsCount: number; maxDownloads: number; expiresAt: string; revokedAt: string | null }[];
}

const STATUSES = ["", "pending", "paid", "fulfilled", "failed", "refunded", "disputed"];
const money = (n: number) => `$${n.toFixed(2)}`;

export default function OrdersPanel({ dict }: { dict: OrdersDict }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [note, setNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState<null | (() => void)>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, status, page: String(page), pageSize: "20" });
    const res = await fetch(`/api/admin/office/orders?${params}`);
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as { orders: OrderSummary[]; total: number; pages: number };
    setOrders(d.orders); setTotal(d.total); setPages(d.pages);
  }, [q, status, page]);

  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  async function openDetail(id: string) {
    const res = await fetch(`/api/admin/office/orders/${encodeURIComponent(id)}`);
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as OrderDetail;
    setDetail(d); setNote(d.order.note ?? ""); setRefundAmount("");
    setError(null);
  }

  async function postAction(id: string, body: unknown) {
    const res = await fetch(`/api/admin/office/orders/${encodeURIComponent(id)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { setError(d.error ?? `HTTP ${res.status}`); return false; }
    return true;
  }

  async function doRefund(full: boolean) {
    if (!detail) return;
    setError(null); setNotice(null);
    const remaining = Math.round((detail.order.totalUSD - detail.order.refundUSD) * 100) / 100;
    const amount = full ? undefined : Number(refundAmount);
    if (!full && (!(amount! > 0) || amount! > remaining)) { setError("INVALID_AMOUNT"); return; }
    const attempt = async (): Promise<boolean> => {
      const res = await fetch(`/api/admin/office/orders/${encodeURIComponent(detail.order.id)}/refund`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(amount !== undefined ? { amountUSD: amount } : {}),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) return true;
      if (d.error === "STEP_UP_REQUIRED") {
        setNeedsStepUp(() => () => { void attempt().then((ok) => { if (ok) finishRefund(); }); });
        return false;
      }
      setError(d.error ?? `HTTP ${res.status}`);
      return false;
    };
    if (await attempt()) finishRefund();
  }

  function finishRefund() {
    setNeedsStepUp(null);
    setNotice(dict.refundDone);
    if (detail) void openDetail(detail.order.id);
    void load();
  }

  return (
    <div>
      <form className="admin-form office-inline" onSubmit={(e) => e.preventDefault()}>
        <label>
          <input type="search" value={q} placeholder={dict.searchPh}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
        <label>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? dict.allStatuses : s}</option>)}
          </select>
        </label>
        <span className="muted">{total}</span>
      </form>
      {error && <p className="form-error">{error}</p>}
      {notice && <p className="ok-text">{notice}</p>}

      <div style={{ overflowX: "auto" }}>
        <table className="admin-table">
          <thead><tr><th>ID</th><th>Email</th><th>Status</th><th>Total</th><th>{dict.refund}</th><th>Date</th><th /></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td><code>{o.id.slice(0, 18)}…</code></td><td>{o.email}</td><td>{o.status}</td>
                <td>{money(o.totalUSD)}</td><td>{o.refundUSD > 0 ? money(o.refundUSD) : "—"}</td>
                <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                <td><button type="button" className="btn" onClick={() => void openDetail(o.id)}>{dict.detail}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
        <span className="muted">{page} / {Math.max(1, pages)}</span>
        <button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>→</button>
      </div>

      {detail && (
        <div className="panel office-detail">
          <h3><code>{detail.order.id}</code></h3>
          <p className="summary-row"><span>{detail.order.email}</span><span>{detail.order.status} · {detail.order.provider} · {money(detail.order.totalUSD)}</span></p>
          <table className="admin-table">
            <tbody>
              {detail.order.items.map((i) => (
                <tr key={i.productId}><td>{i.productId}</td><td>{money(i.priceUSD)}</td></tr>
              ))}
            </tbody>
          </table>
          <h4>{dict.grants}</h4>
          {detail.grants.length === 0 ? <p className="muted">—</p> : (
            <table className="admin-table">
              <tbody>
                {detail.grants.map((g) => (
                  <tr key={g.id}><td>{g.productId}</td>
                    <td>{g.downloadsCount}/{g.maxDownloads} {dict.downloadsUsed}</td>
                    <td>{g.revokedAt ? "revoked" : new Date(g.expiresAt).toLocaleDateString()}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="btn-row">
            <button type="button" className="btn" onClick={async () => {
              if (await postAction(detail.order.id, { action: "resend" })) setNotice(dict.resent);
            }}>{dict.resend}</button>
          </div>
          <form className="admin-form" onSubmit={async (e) => {
            e.preventDefault();
            if (await postAction(detail.order.id, { action: "note", note })) setNotice(dict.saved);
          }}>
            <label>{dict.note}<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} /></label>
            <button type="submit" className="btn">{dict.noteSave}</button>
          </form>
          {(detail.order.status === "paid" || detail.order.status === "fulfilled") && (
            <div className="office-refund">
              <h4>{dict.refund}</h4>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => void doRefund(true)}>{dict.refundFull}</button>
                <label>{dict.refundAmount}
                  <input type="number" step="0.01" min="0" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
                </label>
                <button type="button" className="btn" onClick={() => void doRefund(false)}>{dict.refundPartial}</button>
              </div>
              {needsStepUp && <StepUpForm dict={dict.stepUp} onDone={() => needsStepUp()} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
