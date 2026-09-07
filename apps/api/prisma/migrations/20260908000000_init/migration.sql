-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'read_only', 'closed');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'office', 'technician');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('browser', 'device', 'admin');

-- CreateEnum
CREATE TYPE "CustomerKind" AS ENUM ('etazhna_sobstvenost', 'professional_manager', 'company', 'institution');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('house_manager', 'cashier', 'manager', 'other');

-- CreateEnum
CREATE TYPE "GeocodeStatus" AS ENUM ('pending', 'ok', 'failed', 'manual');

-- CreateEnum
CREATE TYPE "DriveType" AS ENUM ('electric', 'hydraulic', 'mrl');

-- CreateEnum
CREATE TYPE "DoorType" AS ENUM ('manual', 'semi_auto', 'auto');

-- CreateEnum
CREATE TYPE "ElevatorStatus" AS ENUM ('active', 'stopped_by_firm', 'stopped_by_authority', 'out_of_contract', 'scrapped');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'active', 'terminated');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('preview', 'committed', 'rolled_back');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legalForm" TEXT,
    "eik" TEXT NOT NULL,
    "vatNo" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "emergencyPhone" TEXT NOT NULL,
    "email" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'bg',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Sofia',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '{}',
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "technician" JSONB,
    "lastLoginAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "adminId" UUID,
    "tokenHash" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL DEFAULT 'browser',
    "deviceName" TEXT,
    "clientVersion" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "CustomerKind" NOT NULL,
    "name" TEXT NOT NULL,
    "eik" TEXT,
    "vatNo" TEXT,
    "billingAddress" TEXT,
    "invoiceEmail" TEXT,
    "notes" TEXT,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID,
    "buildingId" UUID,
    "name" TEXT NOT NULL,
    "role" "ContactRole" NOT NULL DEFAULT 'house_manager',
    "phone" TEXT,
    "hasViber" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID,
    "address" JSONB NOT NULL,
    "addressText" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geocodeStatus" "GeocodeStatus" NOT NULL DEFAULT 'pending',
    "geocodeConfidence" DOUBLE PRECISION,
    "geocodeProvider" TEXT,
    "accessNotes" TEXT,
    "keysLocation" TEXT,
    "notes" TEXT,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elevator" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "internalNo" TEXT NOT NULL,
    "regNo" TEXT,
    "regNoNormalized" TEXT,
    "inspectionBody" TEXT,
    "manufacturer" TEXT,
    "year" INTEGER,
    "driveType" "DriveType" NOT NULL DEFAULT 'electric',
    "doorType" "DoorType" NOT NULL DEFAULT 'manual',
    "stops" INTEGER NOT NULL,
    "loadKg" INTEGER,
    "status" "ElevatorStatus" NOT NULL DEFAULT 'active',
    "checkIntervalDays" INTEGER,
    "lastCheckAt" DATE,
    "nextInspectionAt" DATE,
    "alarmDevicePhone" TEXT,
    "alarmSimOperator" TEXT,
    "publicCode" TEXT NOT NULL,
    "notes" TEXT,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "elevator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "status" "ContractStatus" NOT NULL DEFAULT 'active',
    "paymentDay" INTEGER,
    "notes" TEXT,
    "terminatedReason" TEXT,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_elevator" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "elevatorId" UUID NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,

    CONSTRAINT "contract_elevator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'preview',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "createdRows" JSONB,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_event" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "causationId" UUID,
    "correlationId" UUID,

    CONSTRAINT "domain_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" UUID,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "ip" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE INDEX "user_tenantId_role_idx" ON "user"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_username_key" ON "platform_admin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "session_tokenHash_key" ON "session"("tokenHash");

-- CreateIndex
CREATE INDEX "session_tenantId_userId_idx" ON "session"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE INDEX "customer_tenantId_name_idx" ON "customer"("tenantId", "name");

-- CreateIndex
CREATE INDEX "contact_tenantId_customerId_idx" ON "contact"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "contact_tenantId_buildingId_idx" ON "contact"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "building_tenantId_customerId_idx" ON "building"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "building_tenantId_geocodeStatus_idx" ON "building"("tenantId", "geocodeStatus");

-- CreateIndex
CREATE INDEX "building_tenantId_addressText_idx" ON "building"("tenantId", "addressText");

-- CreateIndex
CREATE INDEX "elevator_tenantId_buildingId_idx" ON "elevator"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "elevator_tenantId_status_idx" ON "elevator"("tenantId", "status");

-- CreateIndex
CREATE INDEX "elevator_tenantId_regNoNormalized_idx" ON "elevator"("tenantId", "regNoNormalized");

-- CreateIndex
CREATE INDEX "elevator_tenantId_lastCheckAt_idx" ON "elevator"("tenantId", "lastCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "elevator_tenantId_publicCode_key" ON "elevator"("tenantId", "publicCode");

-- CreateIndex
CREATE INDEX "contract_tenantId_buildingId_idx" ON "contract"("tenantId", "buildingId");

-- CreateIndex
CREATE INDEX "contract_tenantId_customerId_idx" ON "contract"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "contract_tenantId_status_idx" ON "contract"("tenantId", "status");

-- CreateIndex
CREATE INDEX "contract_elevator_tenantId_contractId_idx" ON "contract_elevator"("tenantId", "contractId");

-- CreateIndex
CREATE INDEX "contract_elevator_tenantId_elevatorId_idx" ON "contract_elevator"("tenantId", "elevatorId");

-- CreateIndex
CREATE INDEX "import_batch_tenantId_createdAt_idx" ON "import_batch"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "domain_event_tenantId_occurredAt_idx" ON "domain_event"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_event_aggregateType_aggregateId_idx" ON "domain_event"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_at_idx" ON "audit_log"("tenantId", "at");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "platform_admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building" ADD CONSTRAINT "building_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building" ADD CONSTRAINT "building_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elevator" ADD CONSTRAINT "elevator_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elevator" ADD CONSTRAINT "elevator_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_elevator" ADD CONSTRAINT "contract_elevator_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_elevator" ADD CONSTRAINT "contract_elevator_elevatorId_fkey" FOREIGN KEY ("elevatorId") REFERENCES "elevator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

