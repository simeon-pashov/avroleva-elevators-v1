-- CreateEnum
CREATE TYPE "TimestampSource" AS ENUM ('device', 'server', 'manual');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('photo', 'document');

-- CreateEnum
CREATE TYPE "AttachmentRole" AS ENUM ('photo', 'logbook_page');

-- AlterTable
ALTER TABLE "elevator" ADD COLUMN     "goodsOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "visit" ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "clientOffsetMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gps" JSONB,
ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "templateVersion" INTEGER,
ADD COLUMN     "timestampSource" "TimestampSource" NOT NULL DEFAULT 'server';

-- CreateTable
CREATE TABLE "device_enrollment_token" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_enrollment_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" JSONB NOT NULL,
    "groups" JSONB NOT NULL DEFAULT '[]',
    "items" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "checklist_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'photo',
    "sha256" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "takenAt" TIMESTAMPTZ,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_attachment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "attachmentId" UUID NOT NULL,
    "role" "AttachmentRole" NOT NULL DEFAULT 'photo',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_enrollment_token_codeHash_key" ON "device_enrollment_token"("codeHash");

-- CreateIndex
CREATE INDEX "device_enrollment_token_tenantId_userId_idx" ON "device_enrollment_token"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "checklist_template_tenantId_key_active_idx" ON "checklist_template"("tenantId", "key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_template_tenantId_key_version_key" ON "checklist_template"("tenantId", "key", "version");

-- CreateIndex
CREATE INDEX "attachment_tenantId_createdAt_idx" ON "attachment"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "attachment_tenantId_sha256_idx" ON "attachment"("tenantId", "sha256");

-- CreateIndex
CREATE INDEX "visit_attachment_tenantId_attachmentId_idx" ON "visit_attachment"("tenantId", "attachmentId");

-- CreateIndex
CREATE UNIQUE INDEX "visit_attachment_tenantId_visitId_attachmentId_key" ON "visit_attachment"("tenantId", "visitId", "attachmentId");

-- CreateIndex
CREATE INDEX "idempotency_key_createdAt_idx" ON "idempotency_key"("createdAt");

-- AddForeignKey
ALTER TABLE "device_enrollment_token" ADD CONSTRAINT "device_enrollment_token_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_enrollment_token" ADD CONSTRAINT "device_enrollment_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
