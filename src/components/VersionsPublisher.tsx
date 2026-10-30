"use client";
/**
 * Admin version publisher (Phase 3, feature 1): records a new product
 * version against the currently bound deliverable (uploaded through the
 * Product files flow) — existing download links keep working and start
 * serving the new version; buyers are emailed when a DB provides the
 * buyer list, and the result reports exactly what happened.
 */
import { useState } from "react";

export interface VersionsDict {
  publish: string; notes: string; done: string; version: string; product: string;
}

export default function VersionsPublisher({
  dict,
  products,
}: {
  dict: VersionsDict;
  products: { id: string; title: string }[];
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function publish() {
    setMsg(null);
    try {
      const res = await fetch("/api/admin/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, version, notes: notes || undefined }),
      });
      const data = (await res.json()) as { error?: string; emailsQueued?: number; emailNote?: string };
      if (!res.ok) { setIsError(true); setMsg(data.error ?? "error"); return; }
      setIsError(false);
      setMsg(`${dict.done} · emails: ${data.emailsQueued ?? 0} (${data.emailNote ?? ""})`);
    } catch { setIsError(true); setMsg("network"); }
  }

  return (
    <div className="checkout-form">
      <label>
        {dict.product}
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
        </select>
      </label>
      <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.1.0" aria-label={dict.version} />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={dict.notes} aria-label={dict.notes} />
      <button type="button" className="btn btn-primary" onClick={() => void publish()}>{dict.publish}</button>
      {msg && <p className={isError ? "err-text" : "ok-text"} role="status">{msg}</p>}
    </div>
  );
}
