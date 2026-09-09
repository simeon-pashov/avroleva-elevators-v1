-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('manual', 'bank_import', 'provider');

-- CreateEnum
CREATE TYPE "AdjustmentKind" AS ENUM ('late_fee');

-- CreateEnum
CREATE TYPE "LateFeeKind" AS ENUM ('flat', 'percent');

-- CreateEnum
CREATE TYPE "BankImportStatus" AS ENUM ('preview', 'committed');

-- CreateEnum
CREATE TYPE "BankRowStatus" AS ENUM ('proposed', 'matched', 'unallocated', 'ignored', 'booked');

-- CreateEnum
CREATE TYPE "BankMatchKind" AS ENUM ('reference', 'amount_name', 'manual', 'none');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('open', 'paid', 'expired');

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'partially_paid';

-- AlterTable
ALTER TABLE "contract" ADD COLUMN     "billing" JSONB;

-- AlterTable
ALTER TABLE "invoice" ADD COLUMN     "creditedCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dunningAt" TIMESTAMPTZ,
ADD COLUMN     "dunningStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dunningStageKey" TEXT,
ADD COLUMN     "lateFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentReference" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sourceId" UUID,
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'contract';

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "bankImportRowId" UUID,
ADD COLUMN     "counterparty" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "source" "PaymentSource" NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "credit_note" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "issuedAt" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_sequence" (
    "tenantId" UUID NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "credit_note_sequence_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "invoice_adjustment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "kind" "AdjustmentKind" NOT NULL DEFAULT 'late_fee',
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "stageKey" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dunning_stage" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "lateFeeRuleKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dunning_stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_fee_rule" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "key" TEXT NOT NULL,
    "kind" "LateFeeKind" NOT NULL DEFAULT 'flat',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "percentBp" INTEGER NOT NULL DEFAULT 0,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "capCents" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "late_fee_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_import" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "BankImportStatus" NOT NULL DEFAULT 'preview',
    "mapping" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMPTZ,

    CONSTRAINT "bank_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_import_row" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "bookedAt" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "counterparty" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "matchKind" "BankMatchKind" NOT NULL DEFAULT 'none',
    "invoiceId" UUID,
    "buildingId" UUID,
    "paymentId" UUID,
    "status" "BankRowStatus" NOT NULL DEFAULT 'unallocated',
    "note" TEXT,

    CONSTRAINT "bank_import_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_link" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'open',
    "providerRef" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "paidAt" TIMESTAMPTZ,

    CONSTRAINT "payment_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_note_tenantId_invoiceId_idx" ON "credit_note"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "credit_note_tenantId_issuedAt_idx" ON "credit_note"("tenantId", "issuedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_tenantId_number_key" ON "credit_note"("tenantId", "number");

-- CreateIndex
CREATE INDEX "invoice_adjustment_tenantId_invoiceId_idx" ON "invoice_adjustment"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "dunning_stage_tenantId_position_idx" ON "dunning_stage"("tenantId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "dunning_stage_tenantId_key_key" ON "dunning_stage"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_rule_tenantId_key_key" ON "late_fee_rule"("tenantId", "key");

-- CreateIndex
CREATE INDEX "bank_import_tenantId_createdAt_idx" ON "bank_import"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "bank_import_row_tenantId_importId_position_idx" ON "bank_import_row"("tenantId", "importId", "position");

-- CreateIndex
CREATE INDEX "bank_import_row_tenantId_status_idx" ON "bank_import_row"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_token_key" ON "payment_link"("token");

-- CreateIndex
CREATE INDEX "payment_link_tenantId_invoiceId_idx" ON "payment_link"("tenantId", "invoiceId");


-- Backfill (ADR 0001 section 7): the immutable payer reference of every existing invoice, from the
-- tenant's EIK and the invoice number, before the unique index is created.
UPDATE "invoice" i SET "paymentReference" = 'AE-' || right(t."eik", 4) || '-' || lpad(i."number"::text, 6, '0')
FROM "tenant" t WHERE t."id" = i."tenantId" AND i."paymentReference" = '';

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_paymentReference_key" ON "invoice"("tenantId", "paymentReference");

-- CreateIndex
CREATE INDEX "payment_tenantId_providerRef_idx" ON "payment"("tenantId", "providerRef");

-- AddForeignKey
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_adjustment" ADD CONSTRAINT "invoice_adjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_import_row" ADD CONSTRAINT "bank_import_row_importId_fkey" FOREIGN KEY ("importId") REFERENCES "bank_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link" ADD CONSTRAINT "payment_link_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

