-- Phase 2: social delivery channels (WhatsApp / Messenger / Instagram).
-- Adds the ClaimCode table, encrypted-consent storage, and delivery-attempt
-- correlation fields. All changes are additive; Phase 1 data is untouched.

-- AlterTable: Order gains the checkout delivery preference (hash only).
ALTER TABLE "Order" ADD COLUMN "deliveryChannel" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliverySubjectHash" TEXT;

-- AlterTable: DeliveryAttempt gains grant correlation + provider message id.
ALTER TABLE "DeliveryAttempt" ADD COLUMN "grantId" TEXT;
ALTER TABLE "DeliveryAttempt" ADD COLUMN "providerRef" TEXT;
ALTER TABLE "DeliveryAttempt" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: ConsentRecord gains AES-256-GCM ciphertext of the subject.
ALTER TABLE "ConsentRecord" ADD COLUMN "subjectCipher" TEXT;

-- CreateTable
CREATE TABLE "ClaimCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productIds" TEXT[],
    "channel" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaimCode_codeHash_key" ON "ClaimCode"("codeHash");

-- CreateIndex
CREATE INDEX "ClaimCode_orderId_idx" ON "ClaimCode"("orderId");

-- CreateIndex
CREATE INDEX "ClaimCode_expiresAt_idx" ON "ClaimCode"("expiresAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_providerRef_idx" ON "DeliveryAttempt"("providerRef");

-- AddForeignKey
ALTER TABLE "ClaimCode" ADD CONSTRAINT "ClaimCode_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
