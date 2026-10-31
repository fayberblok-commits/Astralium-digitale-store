"use client";

/**
 * Manager's Office — customers (Phase 4 upgrade, item 3): per-customer
 * aggregates from the order ledger + ban/unban. Banning writes to the
 * fraud shield's hash-only blacklist, which checkout already enforces;
 * the API requires the `commerce` permission and audit-logs both ways.
 */
import { useEffect, useState } from "react";

export interface CustomersDict {
  loading: string; customer: string; totalSpend: string; ordersCount: string;
  lastOrder: string; ban: string; unban: string; banned: string; empty: string;
}

interface Customer {
  email: string; orders: number; spendUSD: number;
  refundedUSD: number; lastOrderAt: string; banned: boolean;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function CustomersPanel({ dict }: { dict: CustomersDict }) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/office/customers");
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    const d = (await res.json()) as { customers: Customer[] };
    setCustomers(d.customers);
  }
  useEffect(() => { void load(); }, []);

  async function setBan(email: string, banned: boolean) {
    const res = await fetch("/api/admin/office/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: banned ? "ban" : "unban", email }),
    });
    if (!res.ok) { setError(`HTTP ${res.status}`); return; }
    await load();
  }

  if (!customers) return <p className="muted">{error ?? dict.loading}</p>;
  if (customers.length === 0) return <p className="muted">{dict.empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      {error && <p className="form-error">{error}</p>}
      <table className="admin-table">
        <thead>
          <tr><th>{dict.customer}</th><th>{dict.totalSpend}</th><th>{dict.ordersCount}</th><th>{dict.lastOrder}</th><th /></tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.email}>
              <td>{c.email} {c.banned && <span className="pill pill-bad">{dict.banned}</span>}</td>
              <td>{money(c.spendUSD)}</td>
              <td>{c.orders}</td>
              <td>{new Date(c.lastOrderAt).toLocaleDateString()}</td>
              <td>
                <button type="button" className="btn" onClick={() => void setBan(c.email, !c.banned)}>
                  {c.banned ? dict.unban : dict.ban}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
