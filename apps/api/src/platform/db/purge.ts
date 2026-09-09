import { prismaBase } from './prisma.js'
import { logger } from '../logger.js'
import { adapters } from '../adapters/index.js'
import { audit } from '../audit.js'

/**
 * Hard delete of everything a tenant owns (the only hard delete in the product, ARCHITECTURE
 * section 3 / 6). Order: dependents before identity tables; module tables are addressed by their
 * SQL names so a module rewrite adds one line here. Files (attachments, exports) are removed
 * through the FileStorage port first; the tenant row goes last, then one platform-level audit line
 * (tenantId NULL) records that the purge happened.
 */
export const PURGE_ORDER: readonly string[] = [
  'idempotency_key',
  'notification',
  'notification_rule',
  'notification_template',
  'report_run',
  'export_job',
  'visit_attachment',
  'attachment',
  'device_enrollment_token',
  'session',
  'checklist_template',
  'alarm_device_test',
  'inspection',
  'defect',
  'callback_event',
  'callback',
  'job_event',
  'job_line',
  'job',
  'job_stage',
  'day_plan',
  'technician_pair',
  'building_access_link',
  'payment_link',
  'bank_import_row',
  'bank_import',
  'invoice_adjustment',
  'credit_note',
  'credit_note_sequence',
  'payment',
  'invoice',
  'invoice_sequence',
  'dunning_stage',
  'late_fee_rule',
  'visit_technician',
  'visit',
  'import_batch',
  'contract_elevator',
  'contract',
  'elevator',
  'contact',
  'building',
  'zone',
  'customer',
  'user',
  'audit_log',
  'domain_event',
]

export interface PurgeResult {
  tenantId: string
  rows: Record<string, number>
  files: number
}

export async function purgeTenantData(
  tenantId: string,
  fileKeys: string[],
  actorNote: string,
): Promise<PurgeResult> {
  let files = 0
  for (const key of fileKeys) {
    try {
      await adapters.storage.remove(key)
      files++
    } catch (err) {
      logger.warn({ err, key }, 'purge: file removal failed (continuing)')
    }
  }
  const rows: Record<string, number> = {}
  await prismaBase.$transaction(async (tx) => {
    // Event deliveries reference domain_event by id (no tenantId column).
    rows.event_delivery = await tx.$executeRawUnsafe(
      `DELETE FROM "event_delivery" WHERE "eventId" IN (SELECT id FROM "domain_event" WHERE "tenantId" = $1::uuid)`,
      tenantId,
    )
    for (const table of PURGE_ORDER) {
      rows[table] = await tx.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "tenantId" = $1::uuid`,
        tenantId,
      )
    }
    rows.tenant = await tx.$executeRawUnsafe(`DELETE FROM "tenant" WHERE id = $1::uuid`, tenantId)
  })
  await audit(
    { tenantId: null, actorType: 'system', actorId: null, requestId: 'tenancy.deletionSweep' },
    {
      action: 'tenant.purged',
      entityType: 'tenant',
      entityId: tenantId,
      after: { rows, files, note: actorNote },
    },
  )
  logger.info({ tenantId, rows, files }, 'tenant purged')
  return { tenantId, rows, files }
}

/**
 * Operational data only (ADR 0001 section 6, demo reset): everything a year of running the
 * business produced - visits, callbacks, defects, inspections, money, notifications, reports,
 * exports, events - while the tenant, its users, settings, customers, buildings, elevators and
 * contracts stay. Only the demo reset calls this, and only for tenants with `demoMode` on (the
 * caller checks). Attachments' files go through the storage port first.
 */
export const OPERATIONAL_PURGE_ORDER: readonly string[] = [
  'idempotency_key',
  'notification',
  'report_run',
  'export_job',
  'visit_attachment',
  'attachment',
  'alarm_device_test',
  'inspection',
  'defect',
  'callback_event',
  'callback',
  'job_event',
  'job_line',
  'job',
  'day_plan',
  'building_access_link',
  'payment_link',
  'bank_import_row',
  'bank_import',
  'invoice_adjustment',
  'credit_note',
  'credit_note_sequence',
  'payment',
  'invoice',
  'invoice_sequence',
  'visit_technician',
  'visit',
  'domain_event',
]

export async function purgeOperationalData(
  tenantId: string,
  fileKeys: string[],
  actorNote: string,
): Promise<PurgeResult> {
  let files = 0
  for (const key of fileKeys) {
    try {
      await adapters.storage.remove(key)
      files++
    } catch (err) {
      logger.warn({ err, key }, 'demo reset: file removal failed (continuing)')
    }
  }
  const rows: Record<string, number> = {}
  await prismaBase.$transaction(async (tx) => {
    rows.event_delivery = await tx.$executeRawUnsafe(
      `DELETE FROM "event_delivery" WHERE "eventId" IN (SELECT id FROM "domain_event" WHERE "tenantId" = $1::uuid)`,
      tenantId,
    )
    for (const table of OPERATIONAL_PURGE_ORDER) {
      rows[table] = await tx.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "tenantId" = $1::uuid`,
        tenantId,
      )
    }
    // The registry keeps its rows but forgets the derived evidence dates.
    rows.elevator_reset = await tx.$executeRawUnsafe(
      `UPDATE "elevator" SET "lastCheckAt" = NULL, "nextCheckDueAt" = NULL, "nextCheckOverrideAt" = NULL WHERE "tenantId" = $1::uuid`,
      tenantId,
    )
  })
  await audit(
    { tenantId, actorType: 'system', actorId: null, requestId: 'tenancy.demoReset' },
    {
      action: 'tenant.demoReset',
      entityType: 'tenant',
      entityId: tenantId,
      after: { rows, files, note: actorNote },
    },
  )
  logger.info({ tenantId, rows, files }, 'demo tenant operational data purged')
  return { tenantId, rows, files }
}
