import { prismaBase as db } from '../platform/db/prisma.js'
import { purgeOperationalData } from '../platform/db/purge.js'
import type { AuditActor } from '../platform/audit.js'
import * as documents from '../modules/documents/index.js'
import { exportStorageKeys } from '../modules/reporting/index.js'
import { assertDemoMode, generateDemoData } from './generator.js'
import type { GenerateResult } from './generator.js'

/**
 * Restores a demo tenant to its snapshot (ADR 0001 section 6): the tenant, users, settings and
 * registry stay; every operational record and file goes; the generator writes the year again.
 * Refuses tenants without `features.demoMode` - this is the only hard delete besides the
 * owner-requested purge, and it is scoped to demo firms by construction.
 */
export async function resetDemoTenant(
  tenantId: string,
  opts: { actor?: AuditActor; note?: string; months?: number } = {},
): Promise<{ purged: Record<string, number>; files: number; generated: GenerateResult }> {
  await assertDemoMode(tenantId)
  const keys = [
    ...(await documents.storageKeysOf(tenantId)),
    ...(await exportStorageKeys(tenantId)),
  ]
  const purged = await purgeOperationalData(tenantId, keys, opts.note ?? 'demo reset')
  const generated = await generateDemoData(tenantId, { actor: opts.actor, months: opts.months })
  return { purged: purged.rows, files: purged.files, generated }
}

/** Tenants the nightly reset job acts on. */
export async function listDemoTenantIds(): Promise<string[]> {
  const rows = await db.tenant.findMany({
    where: { deletedAt: null, status: 'active' },
    select: { id: true, features: true },
  })
  return rows
    .filter((t) => (t.features as { demoMode?: boolean } | null)?.demoMode === true)
    .map((t) => t.id)
}
