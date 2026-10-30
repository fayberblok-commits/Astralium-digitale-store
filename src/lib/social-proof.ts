/**
 * Social proof (Phase 5, feature 24). Flag `social_proof` — default OFF.
 *
 * REAL DATA ONLY — this is the owner's red line, enforced structurally:
 * every number comes from an actual store (DB Order / DownloadGrant
 * rows, or APPROVED reviews from the Phase-3 review store). There is
 * no seed data, no random "someone bought" generator, no name lists.
 * When the underlying count is ZERO the model builder returns null and
 * the component renders nothing at all.
 *
 * The recent-purchase ticker masks buyers to a FIRST NAME derived from
 * their real order email's local part (never the full address, never a
 * domain, never a country). If no name can be derived, the entry uses a
 * generic "verified buyer" label instead of inventing one.
 */
import { getDb } from "./db.ts";
import { PRODUCTS, getProductById } from "../data/products.ts";
import { aggregateReviews, listReviews } from "./reviews.ts";

export interface RecentPurchase {
  /** First name only, or null → caller renders the generic buyer label. */
  firstName: string | null;
  productTitle: string;
  atISO: string;
}

export interface ProofModel {
  verifiedDownloads: number;
  completedOrders: number;
  reviewCount: number;
  reviewAverage: number;
  recent: RecentPurchase[];
}

/**
 * Derive a display first name from an email local part: "jane.doe@x" →
 * "Jane", "mike1984@x" → "Mike". Returns null when nothing name-like
 * can be derived (single letter, pure digits/symbols) — never guesses.
 */
export function maskBuyerName(email: string): string | null {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const segment = local.split(/[._\-+]/).find((s) => /[a-z\u00C0-\u024F\u0600-\u06FF]/.test(s)) ?? "";
  const cleaned = segment.replace(/[^a-z\u00C0-\u024F\u0600-\u06FF]/g, "");
  if (cleaned.length < 2) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Pure model builder: NOTHING real → null (component renders nothing). */
export function buildProofModel(input: {
  verifiedDownloads: number;
  completedOrders: number;
  reviewCount: number;
  reviewAverage: number;
  recent: RecentPurchase[];
}): ProofModel | null {
  if (
    input.verifiedDownloads <= 0 && input.completedOrders <= 0 &&
    input.reviewCount <= 0 && input.recent.length === 0
  ) {
    return null;
  }
  return {
    verifiedDownloads: Math.max(0, Math.floor(input.verifiedDownloads)),
    completedOrders: Math.max(0, Math.floor(input.completedOrders)),
    reviewCount: Math.max(0, Math.floor(input.reviewCount)),
    reviewAverage: input.reviewAverage,
    recent: input.recent.slice(0, 5),
  };
}

/**
 * Gather the real numbers. Orders/grants exist only in the DB (the
 * zero-DB store keeps no order ledger — webhook/log fulfilment), so
 * without a DB the counts are honestly zero and nothing renders.
 * Approved reviews work in both modes (Phase-3 store).
 */
export async function gatherSocialProof(): Promise<ProofModel | null> {
  let verifiedDownloads = 0;
  let completedOrders = 0;
  const recent: RecentPurchase[] = [];

  const db = await getDb().catch(() => null);
  if (db) {
    try {
      const [grants, orders, latest] = await Promise.all([
        db.downloadGrant.count(),
        db.order.count({ where: { status: { in: ["paid", "fulfilled"] } } }),
        db.order.findMany({
          where: { status: { in: ["paid", "fulfilled"] } },
          include: { items: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);
      verifiedDownloads = grants;
      completedOrders = orders;
      for (const order of latest) {
        const first = order.items[0] ? getProductById(order.items[0].productId) : undefined;
        if (!first) continue;
        recent.push({
          firstName: maskBuyerName(order.email),
          productTitle: first.title,
          atISO: order.createdAt.toISOString(),
        });
      }
    } catch {
      // DB hiccup: fall through with whatever reviews provide.
    }
  }

  let reviewCount = 0;
  let reviewTotal = 0;
  for (const p of PRODUCTS) {
    const approved = await listReviews(p.id, "approved");
    const agg = aggregateReviews(approved);
    reviewCount += agg.count;
    reviewTotal += agg.average * agg.count;
  }
  const reviewAverage = reviewCount > 0 ? Math.round((reviewTotal / reviewCount) * 100) / 100 : 0;

  return buildProofModel({ verifiedDownloads, completedOrders, reviewCount, reviewAverage, recent });
}
