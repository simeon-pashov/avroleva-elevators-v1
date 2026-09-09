-- Step 8 (Task A): job invoices exist without a contract. NULLs never collide in the
-- (tenantId, contractId, periodStart) unique index, so contract invoices keep their guarantee.
ALTER TABLE "invoice" ALTER COLUMN "contractId" DROP NOT NULL;
