import { prismaBase as db } from '../platform/db/prisma.js'
import { events } from '../platform/events/bus.js'
import { audit } from '../platform/audit.js'
import type { AuditActor } from '../platform/audit.js'
import { todayInSofia } from '../platform/clock.js'
import { logger } from '../platform/logger.js'
import { getTenantFeatures } from '../modules/tenancy/index.js'
import { SUBSCRIPTIONS } from '../subscribers.js'
import { ensureDemoRegistry } from './registry.js'
import type { DemoElevatorRow } from './registry.js'
import { seedVisits } from './visits.js'
import { seedDemoBilling } from './billing.js'
import { seedIncidents } from './incidents.js'
import { seedEvidence } from './evidence.js'
import { seedNotifications } from './notifications.js'
import { seedJobs } from './jobs.js'
import { wireModules } from '../wiring.js'

/**
 * Demo-data generator (ADR 0001 section 6) - the one source of truth for `SEED_DEMO`, the
 * platform admin's "generate demo data" button and the nightly demo reset. For ANY tenant:
 * registry sample data only when the tenant has no buildings, then a year of operational data
 * (visits with checklist snapshots and placeholder photos, callbacks with varied response times,
 * defects, inspections, invoices per month with a paid / partial / overdue mix, payments incl.
 * bank-import references, dunning history, notification rows). Runs with event dispatch
 * suppressed and acknowledges the history afterwards: nothing generated is delivered as news.
 */
export interface GenerateOptions {
  months?: number
  actor?: AuditActor
  today?: string
}

export interface GenerateResult {
  tenantId: string
  registryCreated: boolean
  skipped: boolean
  counts: Record<string, number>
}

export async function hasOperationalData(tenantId: string): Promise<boolean> {
  const [visits, invoices, callbacks] = await Promise.all([
    db.visit.count({ where: { tenantId } }),
    db.invoice.count({ where: { tenantId } }),
    db.callback.count({ where: { tenantId } }),
  ])
  return visits + invoices + callbacks > 0
}

export async function generateDemoData(
  tenantId: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const today = opts.today ?? todayInSofia()
  const months = opts.months ?? 12
  const tenant = await db.tenant.findFirst({ where: { id: tenantId, deletedAt: null } })
  if (!tenant) throw new Error(`tenant ${tenantId} not found`)
  const counts: Record<string, number> = {}

  wireModules()
  const result = await events.runQuiet(async () => {
    const hadBuildings = (await db.building.count({ where: { tenantId, deletedAt: null } })) > 0
    let elevatorRows: DemoElevatorRow[]
    let buildingIds: Map<string, string>
    if (!hadBuildings) {
      const r = await ensureDemoRegistry(tenantId, today)
      Object.assign(counts, r.counts)
      elevatorRows = r.elevatorRows
      buildingIds = r.buildingIds
    } else {
      // The tenant's own registry: every elevator with an active contract takes part.
      const rows = await db.elevator.findMany({
        where: { tenantId, deletedAt: null },
        select: {
          id: true,
          buildingId: true,
          status: true,
          internalNo: true,
          checkIntervalDays: true,
          lastCheckAt: true,
        },
        orderBy: { id: 'asc' },
      })
      const settings = (tenant.settings ?? {}) as { checkIntervalDays?: number }
      elevatorRows = rows.map((row, i) => {
        const interval = row.checkIntervalDays ?? settings.checkIntervalDays ?? 30
        const lastCheckAt = row.lastCheckAt
          ? row.lastCheckAt.toISOString().slice(0, 10)
          : addDaysStr(today, -((i * 7) % interval))
        return {
          row,
          seed: {
            building: row.buildingId,
            internalNo: row.internalNo,
            stops: 0,
            dueInDays: null,
            monthlyPriceCents: 0,
          },
          interval,
          lastCheckAt,
        }
      })
      const blds = await db.building.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
      buildingIds = new Map(blds.map((b, i) => [`b${i + 1}`, b.id]))
    }
    if (await hasOperationalData(tenantId)) {
      return { registryCreated: !hadBuildings, skipped: true }
    }
    counts.visits = await seedVisits(tenantId, elevatorRows, today)
    Object.assign(
      counts,
      await seedIncidents(
        tenantId,
        elevatorRows.map((r) => ({
          id: r.row.id,
          buildingId: r.row.buildingId,
          internalNo: r.row.internalNo,
          status: r.row.status,
        })),
        today,
      ),
    )
    Object.assign(counts, await seedEvidence(tenantId))
    const money = await seedDemoBilling(tenantId, buildingIds, today, months)
    Object.assign(counts, money)
    Object.assign(
      counts,
      await seedJobs(
        tenantId,
        elevatorRows.map((r) => ({
          id: r.row.id,
          buildingId: r.row.buildingId,
          status: r.row.status,
        })),
        today,
      ),
    )
    Object.assign(counts, await seedNotifications(tenantId))
    return { registryCreated: !hadBuildings, skipped: false }
  })

  // History, not news: mark every event of the tenant as delivered to every handler.
  counts.acknowledgedEvents = await events.acknowledge(tenantId, SUBSCRIPTIONS)
  await audit(opts.actor ?? { tenantId, actorType: 'system', actorId: null, requestId: 'demo' }, {
    action: 'tenant.demoData',
    entityType: 'tenant',
    entityId: tenantId,
    after: { ...counts, months, skipped: result.skipped, registryCreated: result.registryCreated },
  })
  logger.info({ tenantId, ...counts, skipped: result.skipped }, 'demo data generated')
  return { tenantId, ...result, counts }
}

function addDaysStr(dateOnly: string, days: number): string {
  const d = new Date(dateOnly + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Guard shared by the reset job and the admin endpoint: only demoMode tenants may be reset. */
export async function assertDemoMode(tenantId: string): Promise<void> {
  const features = await getTenantFeatures(tenantId)
  if (!features.demoMode) throw new Error(`tenant ${tenantId} is not in demo mode`)
}
