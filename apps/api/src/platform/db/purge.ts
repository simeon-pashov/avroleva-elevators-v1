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
  'payment',
  'invoice',
  'invoice_sequence',
  'visit_technician',
  'visit',
  'import_batch',
  'contract_elevator',
  'contract',
  'elevator',
  'contact',
  'building',
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
