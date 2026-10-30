/**
 * Social proof strip (Phase 5, feature 24) — REAL DATA ONLY.
 *
 * Renders only when the `social_proof` flag is on AND the store has
 * real numbers (gatherSocialProof returns null when every count is
 * zero, and this renders nothing). Buyers appear first-name-only,
 * derived from their order email — never a full address, never a
 * country, never an invented name.
 */
import type { Dict } from "../i18n/dictionaries";
import { getFlag } from "../lib/flags";
import { gatherSocialProof } from "../lib/social-proof";
import { Stars } from "./ProductCard";

export default async function SocialProof({ locale, dict }: { locale: string; dict: Dict }) {
  if (!(await getFlag("social_proof"))) return null;
  const proof = await gatherSocialProof();
  if (!proof) return null;
  return (
    <section className="section" aria-label={dict.proof_recent_t}>
      <div className="trust-row">
        {proof.verifiedDownloads > 0 && (
          <span className="trust-item">✦ {proof.verifiedDownloads} {dict.proof_downloads}</span>
        )}
        {proof.completedOrders > 0 && (
          <span className="trust-item">✦ {proof.completedOrders} {dict.proof_orders}</span>
        )}
        {proof.reviewCount > 0 && (
          <span className="trust-item">
            <Stars rating={proof.reviewAverage} /> {proof.reviewAverage} · {proof.reviewCount} {dict.proof_rating}
          </span>
        )}
      </div>
      {proof.recent.length > 0 && (
        <>
          <h2>{dict.proof_recent_t}</h2>
          <div className="grid">
            {proof.recent.map((r, i) => (
              <article key={i} className="testimonial">
                <p>
                  <strong>{r.firstName ?? dict.proof_buyer}</strong> {dict.proof_bought}{" "}
                  <strong>{r.productTitle}</strong>
                </p>
                <p className="muted">{new Date(r.atISO).toLocaleDateString(locale)}</p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
