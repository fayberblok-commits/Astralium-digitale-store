"use client";
/**
 * Product reviews (Phase 3, feature 7): approved reviews + aggregate,
 * a verified-purchase-aware submission form (everything lands in the
 * moderation queue), and an APPROVED-only Review/AggregateRating
 * JSON-LD block injected from the same API payload the list renders.
 */
import { useEffect, useState } from "react";
import type { Dict } from "../i18n/dictionaries";
import { Stars } from "./ProductCard";

interface ReviewItem { id: string; rating: number; title: string; body: string; verified: boolean; createdAt: string }

export default function ReviewsSection({
  productId,
  productTitle,
  dict,
}: {
  productId: string;
  productTitle: string;
  dict: Dict;
}) {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [aggregate, setAggregate] = useState<{ count: number; average: number }>({ count: 0, average: 0 });
  const [enabled, setEnabled] = useState(true);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/reviews?productId=${encodeURIComponent(productId)}`);
        if (res.status === 403) { setEnabled(false); return; }
        if (!res.ok) return;
        const data = (await res.json()) as { aggregate: { count: number; average: number }; reviews: ReviewItem[] };
        setAggregate(data.aggregate);
        setReviews(data.reviews);
      } catch { /* section stays empty */ }
    })();
  }, [productId]);

  async function submit() {
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, orderId: orderId || undefined, email, rating, title, body }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setError(data.error ?? "error"); return; }
      setSent(true);
    } catch { setError("network"); }
  }

  if (!enabled) return null;
  const jsonLd = aggregate.count > 0 ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name: productTitle,
    aggregateRating: { "@type": "AggregateRating", ratingValue: aggregate.average, reviewCount: aggregate.count },
    review: reviews.slice(0, 20).map((r) => ({
      "@type": "Review",
      reviewRating: { "@type": "Rating", ratingValue: r.rating },
      author: { "@type": "Person", name: "Verified customer" },
      datePublished: r.createdAt.slice(0, 10),
      reviewBody: r.body,
    })),
  } : null;

  return (
    <section className="section">
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
      <h2>{dict.reviews_t}</h2>
      {reviews.length === 0 ? (
        <p className="empty-note">{dict.review_none}</p>
      ) : (
        <>
          <p><Stars rating={aggregate.average} /> {aggregate.average} · {aggregate.count} {dict.reviews}</p>
          {reviews.map((r) => (
            <article key={r.id} className="panel" style={{ marginBottom: 12 }}>
              <p>
                <Stars rating={r.rating} />{" "}
                {r.verified && <span className="pill pill-ok">{dict.review_verified_badge}</span>}
              </p>
              {r.title && <p><strong>{r.title}</strong></p>}
              <p>{r.body}</p>
            </article>
          ))}
        </>
      )}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{dict.review_write}</h3>
        {sent ? (
          <p className="ok-text" role="status">{dict.review_pending_note}</p>
        ) : (
          <div className="checkout-form">
            <label>
              {dict.review_rating}
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))} aria-label={dict.review_rating}>
                {[5, 4, 3, 2, 1].map((n) => (<option key={n} value={n}>{n} ★</option>))}
              </select>
            </label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={dict.review_title_ph} aria-label={dict.review_title_ph} />
            <input value={body} onChange={(e) => setBody(e.target.value)} placeholder={dict.review_body_ph} aria-label={dict.review_body_ph} />
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder={dict.review_order_ph} aria-label={dict.review_order_ph} />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={dict.review_email_ph} aria-label={dict.review_email_ph} />
            {error && <p className="err-text" role="alert">{error}</p>}
            <button type="button" className="btn btn-primary" onClick={() => void submit()}>{dict.review_submit}</button>
          </div>
        )}
      </div>
    </section>
  );
}
