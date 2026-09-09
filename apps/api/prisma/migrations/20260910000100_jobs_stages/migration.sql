-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('repair', 'modernisation', 'other');

-- CreateEnum
CREATE TYPE "JobOriginType" AS ENUM ('visit', 'callback', 'defect', 'office');

-- CreateEnum
CREATE TYPE "JobLineKind" AS ENUM ('labour', 'part', 'other');

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "elevatorId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "customerId" UUID,
    "kind" "JobKind" NOT NULL DEFAULT 'repair',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "originType" "JobOriginType" NOT NULL DEFAULT 'office',
    "originId" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "quoteVersion" INTEGER NOT NULL DEFAULT 1,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "vatRatePercent" INTEGER NOT NULL DEFAULT 20,
    "approvalEvidence" JSONB,
    "quoteSentAt" TIMESTAMPTZ,
    "quoteValidUntil" DATE,
    "approvedAt" TIMESTAMPTZ,
    "scheduledAt" TIMESTAMPTZ,
    "assignedUserIds" UUID[],
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "visitId" UUID,
    "invoiceId" UUID,
    "invoicedCents" INTEGER NOT NULL DEFAULT 0,
    "warrantyUntil" DATE,
    "rejectedReason" TEXT,
    "cancelledReason" TEXT,
    "notes" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_line" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "quoteVersion" INTEGER NOT NULL DEFAULT 1,
    "kind" "JobLineKind" NOT NULL DEFAULT 'part',
    "description" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "partRef" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_event" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "at" TIMESTAMPTZ NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "EventSource" NOT NULL DEFAULT 'office',
    "byUserId" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "job_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_stage" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "code" TEXT NOT NULL,
    "labelBg" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "allowedNext" TEXT[],
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_stage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_tenantId_status_updatedAt_idx" ON "job"("tenantId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "job_tenantId_elevatorId_createdAt_idx" ON "job"("tenantId", "elevatorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "job_tenantId_buildingId_idx" ON "job"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "job_tenantId_originType_originId_idx" ON "job"("tenantId", "originType", "originId");

-- CreateIndex
CREATE INDEX "job_tenantId_createdAt_idx" ON "job"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "job_line_tenantId_jobId_quoteVersion_position_idx" ON "job_line"("tenantId", "jobId", "quoteVersion", "position");

-- CreateIndex
CREATE INDEX "job_event_tenantId_jobId_at_idx" ON "job_event"("tenantId", "jobId", "at");

-- CreateIndex
CREATE INDEX "job_stage_tenantId_position_idx" ON "job_stage"("tenantId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "job_stage_tenantId_code_key" ON "job_stage"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_elevatorId_fkey" FOREIGN KEY ("elevatorId") REFERENCES "elevator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_line" ADD CONSTRAINT "job_line_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
