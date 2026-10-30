"use client";
/** Admin review moderation queue (Phase 3, feature 7). */
import { useCallback, useEffect, useState } from "react";

export interface ReviewsDict {
  empty: string; approve: string; reject: string; verified: string; unverified: string;
}

interface Pending {
  id: string; productId: string; rating: number; title: string; body: string; verified: boolean; createdAt: string;
}

export default function ReviewsModeration({ dict }: { dict: ReviewsDict }) {
  const [rows, setRows] = useState<Pending[]>([]);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/reviews");
      if (!res.ok) return;
      const data = (await res.json()) as { reviews: Pending[] };
      setRows(data.reviews);
    } catch { /* empty queue */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    await fetch("/api/admin/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    void load();
  }

  if (rows.length === 0) return <p className="empty-note">{dict.empty}</p>;
  return (
    <div>
      {rows.map((r) => (
        <article key={r.id} className="panel" style={{ marginBottom: 10 }}>
          <p>
            <strong>{r.productId}</strong> · {"★".repeat(r.rating)} ·{" "}
            <span className={`pill ${r.verified ? "pill-ok" : "pill-bad"}`}>{r.verified ? dict.verified : dict.unverified}</span>
          </p>
          {r.title && <p><strong>{r.title}</strong></p>}
          <p>{r.body}</p>
          <p style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => void act(r.id, "approve")}>{dict.approve}</button>
            <button type="button" className="btn btn-ghost" onClick={() => void act(r.id, "reject")}>{dict.reject}</button>
          </p>
        </article>
      ))}
    </div>
  );
}
