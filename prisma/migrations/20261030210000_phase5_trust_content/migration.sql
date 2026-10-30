-- DropIndex
DROP INDEX "Product_title_trgm_idx";

-- AlterTable
ALTER TABLE "DeliveryAttempt" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "LicenseKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "activationLimit" INTEGER NOT NULL DEFAULT 3,
    "activations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudEvent" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "amountUSD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudHold" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "emailCipher" TEXT NOT NULL DEFAULT '',
    "score" INTEGER NOT NULL,
    "reasons" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "FraudHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudBlacklist" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudBlacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "bodyMd" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbEvent" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartSnapshot" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "emailCipher" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totalUSD" DOUBLE PRECISION NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'open',
    "recoveryTokenHash" TEXT NOT NULL,
    "recoverySentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_keyHash_key" ON "LicenseKey"("keyHash");

-- CreateIndex
CREATE INDEX "LicenseKey_orderId_idx" ON "LicenseKey"("orderId");

-- CreateIndex
CREATE INDEX "LicenseKey_emailHash_idx" ON "LicenseKey"("emailHash");

-- CreateIndex
CREATE INDEX "LicenseKey_productId_idx" ON "LicenseKey"("productId");

-- CreateIndex
CREATE INDEX "FraudEvent_emailHash_createdAt_idx" ON "FraudEvent"("emailHash", "createdAt");

-- CreateIndex
CREATE INDEX "FraudEvent_ipHash_createdAt_idx" ON "FraudEvent"("ipHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FraudHold_orderId_key" ON "FraudHold"("orderId");

-- CreateIndex
CREATE INDEX "FraudHold_status_createdAt_idx" ON "FraudHold"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FraudBlacklist_emailHash_key" ON "FraudBlacklist"("emailHash");

-- CreateIndex
CREATE INDEX "BlogPost_locale_status_idx" ON "BlogPost"("locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_locale_slug_key" ON "BlogPost"("locale", "slug");

-- CreateIndex
CREATE INDEX "AbEvent_experimentId_type_idx" ON "AbEvent"("experimentId", "type");

-- CreateIndex
CREATE INDEX "AbEvent_experimentId_visitorHash_type_idx" ON "AbEvent"("experimentId", "visitorHash", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CartSnapshot_recoveryTokenHash_key" ON "CartSnapshot"("recoveryTokenHash");

-- CreateIndex
CREATE INDEX "CartSnapshot_emailHash_status_idx" ON "CartSnapshot"("emailHash", "status");

-- CreateIndex
CREATE INDEX "CartSnapshot_status_createdAt_idx" ON "CartSnapshot"("status", "createdAt");

