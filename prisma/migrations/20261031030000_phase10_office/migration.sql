-- Phase 4 upgrade (Manager's Office):
--  1. Product: unit cost (profit accounting), scheduled publishing,
--     per-currency price overrides, per-locale translations.
--  2. Order: refunded amount (partial refunds), owner note, buyer
--     country/locale captured at checkout for sales reporting.
--  3. AnalyticsEvent: device/browser/source dimensions for the live
--     overview (coarse classes only — raw user agents are never stored).
--  4. SupportTicket: the human-handoff intake behind the office
--     support center.

-- AlterTable: Product office fields
ALTER TABLE "Product" ADD COLUMN "costUSD" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "publishAt" TEXT;
ALTER TABLE "Product" ADD COLUMN "priceOverrides" JSONB;
ALTER TABLE "Product" ADD COLUMN "translations" JSONB;

-- AlterTable: Order office fields
ALTER TABLE "Order" ADD COLUMN "refundUSD" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "note" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "country" TEXT;
ALTER TABLE "Order" ADD COLUMN "locale" TEXT;

-- AlterTable: AnalyticsEvent dimensions
ALTER TABLE "AnalyticsEvent" ADD COLUMN "device" TEXT;
ALTER TABLE "AnalyticsEvent" ADD COLUMN "browser" TEXT;
ALTER TABLE "AnalyticsEvent" ADD COLUMN "source" TEXT;

-- CreateTable: SupportTicket
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "orderRef" TEXT,
    "locale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");
CREATE INDEX "SupportTicket_email_idx" ON "SupportTicket"("email");
