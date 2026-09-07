-- CreateEnum
CREATE TYPE "CallbackChannel" AS ENUM ('phone', 'public_page', 'office');
-- CreateEnum
CREATE TYPE "CallbackClassification" AS ENUM ('trapped_persons', 'breakdown', 'complaint', 'other');
-- CreateEnum
CREATE TYPE "CallbackStatus" AS ENUM ('open', 'dispatched', 'on_site', 'released', 'restored', 'closed');
-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('office', 'app', 'public');
-- CreateEnum
CREATE TYPE "ChargeReason" AS ENUM ('misuse', 'vandalism', 'water', 'out_of_hours', 'other');
-- CreateEnum
CREATE TYPE "DefectStatus" AS ENUM ('open', 'notified', 'awaiting_approval', 'scheduled', 'resolved');
-- CreateEnum
CREATE TYPE "DefectSource" AS ENUM ('visit', 'callback', 'office');
-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('low', 'medium', 'high');
-- CreateEnum
CREATE TYPE "InspectionKind" AS ENUM ('periodic', 'after_repair', 'after_stop', 'other');
-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('passed', 'passed_with_defects', 'failed', 'pending');
-- AlterTable
-- publicToken: added nullable, backfilled with 128 random bits (hex) per existing row, then NOT NULL.
-- gen_random_uuid() is in core Postgres 13+; md5 of two random uuids + the row id = 32 hex chars.
ALTER TABLE "elevator" ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "stopReason" TEXT,
ADD COLUMN     "stoppedAt" TIMESTAMPTZ;
UPDATE "elevator" SET "publicToken" = md5(gen_random_uuid()::text || gen_random_uuid()::text || "id"::text) WHERE "publicToken" IS NULL;
ALTER TABLE "elevator" ALTER COLUMN "publicToken" SET NOT NULL;
-- CreateTable
CREATE TABLE "callback" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "elevatorId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "channel" "CallbackChannel" NOT NULL DEFAULT 'phone',
    "callerName" TEXT,
    "callerPhone" TEXT,
    "classification" "CallbackClassification" NOT NULL DEFAULT 'breakdown',
    "trappedCount" INTEGER,
    "description" TEXT NOT NULL,
    "status" "CallbackStatus" NOT NULL DEFAULT 'open',
    "receivedAt" TIMESTAMPTZ NOT NULL,
    "dispatchedAt" TIMESTAMPTZ,
    "onSiteAt" TIMESTAMPTZ,
    "releasedAt" TIMESTAMPTZ,
    "restoredAt" TIMESTAMPTZ,
    "closedAt" TIMESTAMPTZ,
    "assignedUserId" UUID,
    "cause" TEXT,
    "actionTaken" TEXT,
    "chargeable" BOOLEAN NOT NULL DEFAULT false,
    "chargeReason" "ChargeReason",
    "notes" TEXT,
    "slaMinutes" INTEGER NOT NULL,
    "closeoutVisitId" UUID,
    "source" "EventSource" NOT NULL DEFAULT 'office',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "callback_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "callback_event" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "callbackId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "EventSource" NOT NULL DEFAULT 'office',
    "byUserId" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "callback_event_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "defect" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "elevatorId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "catalogCode" TEXT,
    "description" TEXT NOT NULL,
    "severity" "DefectSeverity" NOT NULL DEFAULT 'medium',
    "stopLift" BOOLEAN NOT NULL DEFAULT false,
    "status" "DefectStatus" NOT NULL DEFAULT 'open',
    "recordedAt" TIMESTAMPTZ NOT NULL,
    "sourceType" "DefectSource" NOT NULL DEFAULT 'office',
    "sourceId" UUID,
    "noticeSentAt" TIMESTAMPTZ,
    "customerRequestedAt" TIMESTAMPTZ,
    "followUpDueAt" DATE NOT NULL,
    "resolvedAt" TIMESTAMPTZ,
    "resolvedVisitId" UUID,
    "notes" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "defect_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "inspection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "elevatorId" UUID NOT NULL,
    "kind" "InspectionKind" NOT NULL DEFAULT 'periodic',
    "requestedAt" DATE,
    "scheduledAt" DATE,
    "performedAt" DATE,
    "result" "InspectionResult" NOT NULL DEFAULT 'pending',
    "inspectionBody" TEXT,
    "nextDueAt" DATE,
    "notes" TEXT,
    "defects" JSONB NOT NULL DEFAULT '[]',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "inspection_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "alarm_device_test" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "elevatorId" UUID NOT NULL,
    "testedAt" TIMESTAMPTZ NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "byUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "alarm_device_test_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "callback_tenantId_status_receivedAt_idx" ON "callback"("tenantId", "status", "receivedAt" DESC);
-- CreateIndex
CREATE INDEX "callback_tenantId_elevatorId_receivedAt_idx" ON "callback"("tenantId", "elevatorId", "receivedAt" DESC);
-- CreateIndex
CREATE INDEX "callback_tenantId_receivedAt_idx" ON "callback"("tenantId", "receivedAt" DESC);
-- CreateIndex
CREATE INDEX "callback_tenantId_assignedUserId_status_idx" ON "callback"("tenantId", "assignedUserId", "status");
-- CreateIndex
CREATE INDEX "callback_event_tenantId_callbackId_at_idx" ON "callback_event"("tenantId", "callbackId", "at");
-- CreateIndex
CREATE INDEX "defect_tenantId_status_followUpDueAt_idx" ON "defect"("tenantId", "status", "followUpDueAt");
-- CreateIndex
CREATE INDEX "defect_tenantId_elevatorId_recordedAt_idx" ON "defect"("tenantId", "elevatorId", "recordedAt" DESC);
-- CreateIndex
CREATE INDEX "defect_tenantId_recordedAt_idx" ON "defect"("tenantId", "recordedAt" DESC);
-- CreateIndex
CREATE INDEX "inspection_tenantId_elevatorId_performedAt_idx" ON "inspection"("tenantId", "elevatorId", "performedAt" DESC);
-- CreateIndex
CREATE INDEX "inspection_tenantId_nextDueAt_idx" ON "inspection"("tenantId", "nextDueAt");
-- CreateIndex
CREATE INDEX "inspection_tenantId_scheduledAt_idx" ON "inspection"("tenantId", "scheduledAt");
-- CreateIndex
CREATE INDEX "alarm_device_test_tenantId_elevatorId_testedAt_idx" ON "alarm_device_test"("tenantId", "elevatorId", "testedAt" DESC);
-- CreateIndex
CREATE UNIQUE INDEX "elevator_publicToken_key" ON "elevator"("publicToken");
-- AddForeignKey
ALTER TABLE "callback" ADD CONSTRAINT "callback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "callback" ADD CONSTRAINT "callback_elevatorId_fkey" FOREIGN KEY ("elevatorId") REFERENCES "elevator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "callback" ADD CONSTRAINT "callback_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "callback_event" ADD CONSTRAINT "callback_event_callbackId_fkey" FOREIGN KEY ("callbackId") REFERENCES "callback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "defect" ADD CONSTRAINT "defect_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "defect" ADD CONSTRAINT "defect_elevatorId_fkey" FOREIGN KEY ("elevatorId") REFERENCES "elevator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "defect" ADD CONSTRAINT "defect_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_elevatorId_fkey" FOREIGN KEY ("elevatorId") REFERENCES "elevator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "alarm_device_test" ADD CONSTRAINT "alarm_device_test_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "alarm_device_test" ADD CONSTRAINT "alarm_device_test_elevatorId_fkey" FOREIGN KEY ("elevatorId") REFERENCES "elevator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
