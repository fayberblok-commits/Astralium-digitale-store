import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

delete process.env.DATABASE_URL;

const reviews = await import("../src/lib/reviews.ts");
const { getProductById } = await import("../src/data/products.ts");

const createdIds = [];
after(() => {
  const path = join(process.cwd(), ".data", "reviews.json");
  if (!existsSync(path)) return;
  const rows = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify(rows.filter((r) => !createdIds.includes(r.id)), null, 2));
});

test("no review is ever auto-approved — even a 'verified' one starts pending", () => {
  assert.equal(reviews.initialReviewStatus(true), "pending");
  assert.equal(reviews.initialReviewStatus(false), "pending");
});

test("validation: rating must be an integer 1–5, body 3–2000 chars", () => {
  assert.equal(reviews.validateReviewInput({ rating: 5, body: "Great product" }).ok, true);
  assert.equal(reviews.validateReviewInput({ rating: 0, body: "Great product" }).ok, false);
  assert.equal(reviews.validateReviewInput({ rating: 6, body: "Great product" }).ok, false);
  assert.equal(reviews.validateReviewInput({ rating: 4.5, body: "Great product" }).ok, false);
  assert.equal(reviews.validateReviewInput({ rating: 4, body: "no" }).ok, false);
});

test("moderation flow: submit → pending (invisible) → approve → aggregate + JSON-LD count it", async () => {
  const { review } = await reviews.addReview({
    productId: "p05", email: "phase3-reviewer@example.com", rating: 4,
    title: "Solid", body: "Really useful templates, well organised.",
  });
  createdIds.push(review.id);
  // Without a DB there is no order book to verify against: honestly unverified.
  assert.equal(review.verified, false);
  assert.equal(review.status, "pending");

  let approved = await reviews.listReviews("p05", "approved");
  assert.ok(!approved.some((r) => r.id === review.id));
  assert.equal(reviews.aggregateReviews(await reviews.listReviews("p05")).count >= 0, true);

  const mod = await reviews.moderateReview(review.id, "approved");
  assert.equal(mod.ok, true);
  approved = await reviews.listReviews("p05", "approved");
  assert.ok(approved.some((r) => r.id === review.id));

  const agg = reviews.aggregateReviews(approved);
  assert.ok(agg.count >= 1);
  const mine = approved.filter((r) => r.id === review.id);
  assert.equal(reviews.aggregateReviews(mine).average, 4);

  const ld = reviews.buildReviewJsonLd(getProductById("p05"), approved, "https://example.test");
  assert.ok(ld);
  assert.equal(ld.aggregateRating.reviewCount, agg.count);
  // Emails are never exposed in structured data — author is generic.
  assert.ok(JSON.stringify(ld).includes("Verified customer"));
  assert.ok(!JSON.stringify(ld).includes("phase3-reviewer"));
});

test("aggregate math counts APPROVED only; JSON-LD is null with no approved reviews", () => {
  const mk = (rating, status) => ({
    id: `t-${rating}-${status}`, productId: "p05", emailHash: "x", verified: false,
    rating, title: "", body: "body text", status, createdAt: "2026-01-01T00:00:00.000Z",
  });
  const mixed = [mk(5, "approved"), mk(3, "approved"), mk(1, "pending"), mk(1, "rejected")];
  const agg = reviews.aggregateReviews(mixed);
  assert.equal(agg.count, 2);
  assert.equal(agg.average, 4);
  assert.equal(reviews.buildReviewJsonLd(getProductById("p05"), [mk(5, "pending")], "https://example.test"), null);
  const ld = reviews.buildReviewJsonLd(getProductById("p05"), mixed, "https://example.test");
  assert.equal(ld.aggregateRating.reviewCount, 2);
  assert.equal(ld.review.length, 2);
});
