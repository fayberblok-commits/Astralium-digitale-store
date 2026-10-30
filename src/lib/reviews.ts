/**
 * Product reviews (Phase 3, feature 7).
 *
 * Trust rules (pinned by tests):
 *  - A review is NEVER auto-approved — not even a verified purchase.
 *    Everything lands as "pending" until a moderator approves it.
 *  - Aggregates and JSON-LD count APPROVED reviews only.
 *  - Buyer emails are stored only as SHA-256 hashes.
 *
 * Persistence: DB Review table when configured, else
 * .data/reviews.json. "Verified purchase" = a DB order whose email hash
 * matches and which contains the product; without a DB, verification is
 * honestly unavailable and the review is stored verified=false (it can
 * still be approved by a moderator, labelled unverified in admin).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import type { Product } from "../data/products.ts";

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface ReviewRecord {
  id: string;
  productId: string;
  orderId?: string;
  emailHash: string;
  verified: boolean;
  rating: number;
  title: string;
  body: string;
  status: ReviewStatus;
  createdAt: string;
}

const STORE_PATH = path.join(process.cwd(), ".data", "reviews.json");

export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function readStore(): Promise<ReviewRecord[]> {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as ReviewRecord[];
  } catch {
    return [];
  }
}

async function writeStore(list: ReviewRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(list, null, 2), "utf8");
}

export function validateReviewInput(input: {
  rating?: unknown;
  body?: unknown;
}): { ok: true; rating: number; body: string } | { ok: false; reason: string } {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, reason: "INVALID_RATING" };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length < 3 || body.length > 2000) return { ok: false, reason: "INVALID_BODY" };
  return { ok: true, rating, body };
}

/** Aggregate over APPROVED reviews only. */
export function aggregateReviews(reviews: ReviewRecord[]): { count: number; average: number } {
  const approved = reviews.filter((r) => r.status === "approved");
  if (approved.length === 0) return { count: 0, average: 0 };
  const avg = approved.reduce((s, r) => s + r.rating, 0) / approved.length;
  return { count: approved.length, average: Math.round(avg * 100) / 100 };
}

/** Submitting a review can never produce an approved one directly. */
export function initialReviewStatus(_verified: boolean): ReviewStatus {
  return "pending";
}

export async function listReviews(
  productId: string,
  status?: ReviewStatus,
): Promise<ReviewRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.review.findMany({
        where: { productId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
      });
      if (rows.length > 0 || status) {
        return rows.map((r) => ({
          id: r.id, productId: r.productId, orderId: r.orderId ?? undefined,
          emailHash: r.emailHash, verified: r.verified, rating: r.rating,
          title: r.title, body: r.body, status: r.status as ReviewStatus,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    }
  } catch {
    // fall through
  }
  const all = await readStore();
  return all
    .filter((r) => r.productId === productId && (!status || r.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPendingReviews(): Promise<ReviewRecord[]> {
  try {
    const db = await getDb();
    if (db) {
      const rows = await db.review.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" } });
      if (rows.length > 0) {
        return rows.map((r) => ({
          id: r.id, productId: r.productId, orderId: r.orderId ?? undefined,
          emailHash: r.emailHash, verified: r.verified, rating: r.rating,
          title: r.title, body: r.body, status: "pending" as ReviewStatus,
          createdAt: r.createdAt.toISOString(),
        }));
      }
    }
  } catch {
    // fall through
  }
  return (await readStore()).filter((r) => r.status === "pending");
}

/** Verify a purchase against DB orders (email + order containing product). */
export async function verifyPurchaseDb(email: string, orderId: string | undefined, productId: string): Promise<boolean> {
  if (!orderId) return false;
  try {
    const db = await getDb();
    if (!db) return false;
    const order = await db.order.findFirst({
      where: {
        id: orderId,
        email: email.trim().toLowerCase(),
        status: { in: ["paid", "fulfilled"] },
        items: { some: { productId } },
      },
    });
    return Boolean(order);
  } catch {
    return false;
  }
}

export async function addReview(input: {
  productId: string;
  orderId?: string;
  email: string;
  rating: number;
  title?: string;
  body: string;
}): Promise<{ persisted: "db" | "file"; review: ReviewRecord }> {
  // Phase 6, feature 26: a review awaiting moderation notifies the owner.
  const notifyOwner = async (r: ReviewRecord): Promise<void> => {
    if (r.status !== "pending") return;
    const { recordOwnerEvent } = await import("./owner-alerts.ts");
    void recordOwnerEvent({
      kind: "review_pending",
      title: `Review pending moderation (${r.rating}★, ${r.productId})`,
      detail: { reviewId: r.id, productId: r.productId, rating: r.rating, verified: r.verified },
    });
  };
  const verified = await verifyPurchaseDb(input.email, input.orderId, input.productId);
  const review: ReviewRecord = {
    id: randomUUID(),
    productId: input.productId,
    orderId: input.orderId,
    emailHash: hashEmail(input.email),
    verified,
    rating: input.rating,
    title: (input.title ?? "").slice(0, 120),
    body: input.body,
    status: initialReviewStatus(verified),
    createdAt: new Date().toISOString(),
  };
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      // Product row must exist for the FK; unsynced catalog → file store.
      const product = await db.product.findUnique({ where: { id: input.productId } });
      if (product) {
        const row = await db.review.create({
          data: {
            productId: review.productId, orderId: review.orderId, emailHash: review.emailHash,
            verified: review.verified, rating: review.rating, title: review.title,
            body: review.body, status: review.status,
          },
        });
        const saved = { ...review, id: row.id, createdAt: row.createdAt.toISOString() };
        await notifyOwner(saved);
        return { persisted: "db", review: saved };
      }
    } catch {
      // fall through to file store
    }
  }
  const all = await readStore();
  all.push(review);
  await writeStore(all);
  await notifyOwner(review);
  return { persisted: "file", review };
}

export async function moderateReview(
  id: string,
  status: Exclude<ReviewStatus, "pending">,
): Promise<{ ok: boolean; persisted: "db" | "file" }> {
  const db = await getDb().catch(() => null);
  if (db) {
    try {
      await db.review.update({ where: { id }, data: { status } });
      return { ok: true, persisted: "db" };
    } catch {
      // fall through — the review may live in the file store
    }
  }
  const all = await readStore();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return { ok: false, persisted: "file" };
  all[idx] = { ...all[idx], status };
  await writeStore(all);
  return { ok: true, persisted: "file" };
}

/**
 * Product JSON-LD enriched with APPROVED reviews only. Returns null for
 * the review block when nothing is approved (callers then keep the plain
 * catalog aggregate).
 */
export function buildReviewJsonLd(product: Product, reviews: ReviewRecord[], siteBase: string): Record<string, unknown> | null {
  const approved = reviews.filter((r) => r.status === "approved");
  if (approved.length === 0) return null;
  const agg = aggregateReviews(approved);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    url: `${siteBase}/product/${product.slug}`,
    aggregateRating: { "@type": "AggregateRating", ratingValue: agg.average, reviewCount: agg.count },
    review: approved.slice(0, 20).map((r) => ({
      "@type": "Review",
      reviewRating: { "@type": "Rating", ratingValue: r.rating },
      author: { "@type": "Person", name: "Verified customer" },
      datePublished: r.createdAt.slice(0, 10),
      name: r.title || undefined,
      reviewBody: r.body,
    })),
  };
}
