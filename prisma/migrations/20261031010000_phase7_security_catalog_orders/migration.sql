-- Phase 1 upgrade (security hardening + foundations F1/F2):
--  1. Product editorial fields — the DB becomes the storefront's source
--     of truth (src/lib/catalog.ts); the file catalog stays seed/fallback.
--  2. Order lookup indexes (providerRef was already @unique — it is the
--     provider session/order id and the webhook idempotency anchor).
--  3. SecurityLog — the §13 security audit log table.

-- AlterTable: Product editorial fields (defaults keep existing rows valid)
ALTER TABLE "Product" ADD COLUMN "subtitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'ebooks';
ALTER TABLE "Product" ADD COLUMN "formats" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Product" ADD COLUMN "compareAtUSD" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN "rating" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "reviewsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "badge" TEXT;
ALTER TABLE "Product" ADD COLUMN "includes" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Product" ADD COLUMN "preview" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "hue" INTEGER NOT NULL DEFAULT 222;
ALTER TABLE "Product" ADD COLUMN "publishedAt" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Product" ADD COLUMN "language" TEXT;

-- CreateIndex: Order lookups by buyer and by status/time
CREATE INDEX "Order_email_idx" ON "Order"("email");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateTable: SecurityLog
CREATE TABLE "SecurityLog" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorHash" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityLog_kind_createdAt_idx" ON "SecurityLog"("kind", "createdAt");
CREATE INDEX "SecurityLog_actorHash_createdAt_idx" ON "SecurityLog"("actorHash", "createdAt");
