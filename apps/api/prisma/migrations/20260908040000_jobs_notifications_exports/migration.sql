-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'sms', 'viber_link', 'in_app');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "RecipientKind" AS ENUM ('building_contact', 'owner', 'office', 'assigned_technician');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('generated', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'done', 'failed');

-- AlterEnum
ALTER TYPE "TenantStatus" ADD VALUE 'deletion_scheduled';

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "deletionAt" TIMESTAMPTZ,
ADD COLUMN     "deletionRequestedByUserId" UUID;

-- AlterTable
ALTER TABLE "visit" ADD COLUMN     "photosPurgedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "notification_template" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientKind" "RecipientKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ruleId" UUID,
    "eventId" UUID,
    "eventType" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "to" TEXT NOT NULL,
    "userId" UUID,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
    "providerId" TEXT,
    "error" TEXT,
    "relatedType" TEXT,
    "relatedId" UUID,
    "link" TEXT,
    "meta" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'full',
    "status" "ExportJobStatus" NOT NULL DEFAULT 'queued',
    "requestedByUserId" UUID,
    "storageKey" TEXT,
    "bytes" INTEGER,
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ,
    "finishedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_run" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'building_month',
    "buildingId" UUID,
    "period" TEXT NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'generated',
    "sentTo" TEXT,
    "notificationId" UUID,
    "error" TEXT,
    "byUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_delivery" (
    "eventId" UUID NOT NULL,
    "handler" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ,

    CONSTRAINT "event_delivery_pkey" PRIMARY KEY ("eventId","handler")
);

-- CreateTable
CREATE TABLE "job_run" (
    "name" TEXT NOT NULL,
    "cron" TEXT,
    "lastStartedAt" TIMESTAMPTZ,
    "lastFinishedAt" TIMESTAMPTZ,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastDurationMs" INTEGER,
    "lastResult" JSONB,

    CONSTRAINT "job_run_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "notification_template_key_channel_locale_idx" ON "notification_template"("key", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_tenantId_key_channel_locale_key" ON "notification_template"("tenantId", "key", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rule_tenantId_eventType_channel_recipientKind_key" ON "notification_rule"("tenantId", "eventType", "channel", "recipientKind");

-- CreateIndex
CREATE INDEX "notification_tenantId_createdAt_idx" ON "notification"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notification_tenantId_userId_readAt_idx" ON "notification"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "notification_tenantId_status_idx" ON "notification"("tenantId", "status");

-- CreateIndex
CREATE INDEX "notification_tenantId_relatedType_relatedId_idx" ON "notification"("tenantId", "relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "export_job_tenantId_createdAt_idx" ON "export_job"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "export_job_expiresAt_idx" ON "export_job"("expiresAt");

-- CreateIndex
CREATE INDEX "report_run_tenantId_createdAt_idx" ON "report_run"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "report_run_tenantId_buildingId_period_idx" ON "report_run"("tenantId", "buildingId", "period");

-- CreateIndex
CREATE INDEX "event_delivery_status_createdAt_idx" ON "event_delivery"("status", "createdAt");

