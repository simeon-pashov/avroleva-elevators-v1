-- CreateEnum
CREATE TYPE "DayPlanStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "AccessLinkScope" AS ENUM ('statement', 'statement_and_visits');

-- AlterTable
ALTER TABLE "building" ADD COLUMN     "zoneId" UUID,
ADD COLUMN     "zoneManual" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "zone" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#2563eb',
    "polygon" JSONB,
    "districts" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_pair" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "userIds" UUID[],
    "vehicle" TEXT,
    "defaultZoneId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "technician_pair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_plan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "pairId" UUID,
    "userIds" UUID[],
    "zoneId" UUID,
    "stops" JSONB NOT NULL DEFAULT '[]',
    "status" "DayPlanStatus" NOT NULL DEFAULT 'draft',
    "lockedAt" TIMESTAMPTZ,
    "publishedAt" TIMESTAMPTZ,
    "generatedAt" TIMESTAMPTZ,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "estKm" DOUBLE PRECISION,
    "notes" TEXT,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "day_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_access_link" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "scope" "AccessLinkScope" NOT NULL DEFAULT 'statement',
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokedBy" UUID,
    "lastUsedAt" TIMESTAMPTZ,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastIpHash" TEXT,

    CONSTRAINT "building_access_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zone_tenantId_position_idx" ON "zone"("tenantId", "position");

-- CreateIndex
CREATE INDEX "technician_pair_tenantId_position_idx" ON "technician_pair"("tenantId", "position");

-- CreateIndex
CREATE INDEX "day_plan_tenantId_date_status_idx" ON "day_plan"("tenantId", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "day_plan_tenantId_date_pairId_key" ON "day_plan"("tenantId", "date", "pairId");

-- CreateIndex
CREATE UNIQUE INDEX "building_access_link_token_key" ON "building_access_link"("token");

-- CreateIndex
CREATE INDEX "building_access_link_tenantId_buildingId_idx" ON "building_access_link"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "building_tenantId_zoneId_idx" ON "building"("tenantId", "zoneId");

-- AddForeignKey
ALTER TABLE "building" ADD CONSTRAINT "building_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone" ADD CONSTRAINT "zone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_pair" ADD CONSTRAINT "technician_pair_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_plan" ADD CONSTRAINT "day_plan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_plan" ADD CONSTRAINT "day_plan_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "technician_pair"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_access_link" ADD CONSTRAINT "building_access_link_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_access_link" ADD CONSTRAINT "building_access_link_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
