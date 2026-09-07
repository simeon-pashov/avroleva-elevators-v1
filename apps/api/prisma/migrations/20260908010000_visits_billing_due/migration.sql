-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('functional_check', 'technical_maintenance', 'repair', 'callback', 'other');

-- CreateEnum
CREATE TYPE "VisitSource" AS ENUM ('office', 'paper', 'app');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'paid', 'overdue', 'void');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'bank', 'other');

-- AlterTable
ALTER TABLE "elevator" ADD COLUMN     "nextCheckDueAt" DATE,
ADD COLUMN     "nextCheckOverrideAt" DATE;

-- CreateTable
CREATE TABLE "visit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "elevatorId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "kind" "VisitKind" NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "endedAt" TIMESTAMPTZ,
    "notes" TEXT,
    "source" "VisitSource" NOT NULL DEFAULT 'office',
    "qualityFlags" JSONB NOT NULL DEFAULT '[]',
    "createdByUserId" UUID,
    "supersedesVisitId" UUID,
    "supersededAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_technician" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "userId" UUID,
    "position" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,

    CONSTRAINT "visit_technician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequence" (
    "tenantId" UUID NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_sequence_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "issuedAt" DATE NOT NULL,
    "dueAt" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'issued',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "paidAt" DATE,
    "voidedAt" TIMESTAMPTZ,
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID,
    "buildingId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidAt" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'bank',
    "note" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_tenantId_elevatorId_startedAt_idx" ON "visit"("tenantId", "elevatorId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "visit_tenantId_startedAt_idx" ON "visit"("tenantId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "visit_tenantId_buildingId_idx" ON "visit"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "visit_technician_tenantId_visitId_idx" ON "visit_technician"("tenantId", "visitId");

-- CreateIndex
CREATE INDEX "visit_technician_tenantId_userId_idx" ON "visit_technician"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "invoice_tenantId_status_dueAt_idx" ON "invoice"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "invoice_tenantId_buildingId_periodStart_idx" ON "invoice"("tenantId", "buildingId", "periodStart" DESC);

-- CreateIndex
CREATE INDEX "invoice_tenantId_periodStart_idx" ON "invoice"("tenantId", "periodStart" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_number_key" ON "invoice"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenantId_contractId_periodStart_key" ON "invoice"("tenantId", "contractId", "periodStart");

-- CreateIndex
CREATE INDEX "payment_tenantId_invoiceId_idx" ON "payment"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "payment_tenantId_buildingId_paidAt_idx" ON "payment"("tenantId", "buildingId", "paidAt" DESC);

-- CreateIndex
CREATE INDEX "payment_tenantId_paidAt_idx" ON "payment"("tenantId", "paidAt" DESC);

-- CreateIndex
CREATE INDEX "elevator_tenantId_nextCheckDueAt_idx" ON "elevator"("tenantId", "nextCheckDueAt");

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_elevatorId_fkey" FOREIGN KEY ("elevatorId") REFERENCES "elevator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_technician" ADD CONSTRAINT "visit_technician_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
