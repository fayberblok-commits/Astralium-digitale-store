"use client";
/** Admin license management (Phase 5, feature 18). */
import { useCallback, useEffect, useState } from "react";

export interface LicenseDict {
  products: string; limit: string; save: string; saved: string;
  keys: string; revoke: string; empty: string; status: string; activations: string;
}

interface KeyRow {
  id: string; masked: string; orderId: string; productId: string;
  activationsUsed: number; activationLimit: number; status: string; createdAt: string;
}

interface Config {
  requiredProductIds: string[];
  defaultActivationLimit: number;
  perProductLimit: Record<string, number>;
}

export default function LicenseManager({
  products,
  dict,
}: {
  products: { id: string; title: string }[];
  dict: LicenseDict;
}) {
  const [config, setConfig] = useState<Config>({ requiredProductIds: [], defaultActivationLimit: 3, perProductLimit: {} });
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/license");
      if (!res.ok) return;
      const data = (await res.json()) as { config: Config; keys: KeyRow[] };
      setConfig(data.config);
      setKeys(data.keys);
    } catch { /* empty state renders */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function toggleProduct(id: string, on: boolean) {
    setConfig((c) => ({
      ...c,
      requiredProductIds: on ? [...c.requiredProductIds, id] : c.requiredProductIds.filter((x) => x !== id),
    }));
  }

  async function save() {
    await fetch("/api/admin/license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "config", config }),
    });
    setSaved(true);
    void load();
  }

  async function revoke(id: string) {
    await fetch("/api/admin/license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", id }),
    });
    void load();
  }

  return (
    <div>
      <p><strong>{dict.products}</strong></p>
      <div style={{ display: "grid", gap: 6 }}>
        {products.map((p) => (
          <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={config.requiredProductIds.includes(p.id)}
              onChange={(e) => toggleProduct(p.id, e.target.checked)}
            />
            {p.title}
          </label>
        ))}
      </div>
      <p style={{ marginTop: 12 }}>
        <label>
          {dict.limit}{" "}
          <input
            type="number"
            min={1}
            max={50}
            value={config.defaultActivationLimit}
            onChange={(e) => setConfig((c) => ({ ...c, defaultActivationLimit: Number(e.target.value) }))}
            style={{ width: 80 }}
          />
        </label>{" "}
        <button type="button" className="btn btn-primary" onClick={() => void save()}>{dict.save}</button>
        {saved ? <span className="ok-text"> ✓ {dict.saved}</span> : null}
      </p>

      <h3>{dict.keys}</h3>
      {keys.length === 0 ? (
        <p className="empty-note">{dict.empty}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr><th>Key</th><th>Product</th><th>Order</th><th>{dict.activations}</th><th>{dict.status}</th><th></th></tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td><code>{k.masked}</code></td>
                  <td>{k.productId}</td>
                  <td>{k.orderId}</td>
                  <td>{k.activationsUsed}/{k.activationLimit}</td>
                  <td>{k.status === "active" ? <span className="pill pill-ok">active</span> : <span className="pill pill-bad">{k.status}</span>}</td>
                  <td>
                    {k.status === "active" && (
                      <button type="button" className="btn btn-ghost" onClick={() => void revoke(k.id)}>{dict.revoke}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
