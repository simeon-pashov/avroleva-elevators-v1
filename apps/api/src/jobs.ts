import { calendarRules } from '@avroleva/domain-data'
import { defineJob } from './platform/jobs/registry.js'
import { events } from './platform/events/bus.js'
import { clock, addDays, todayInSofia } from './platform/clock.js'
import { systemCtx } from './platform/http/ctx.js'
import { logger } from './platform/logger.js'
import { purgeTenantData } from './platform/db/purge.js'
import * as tenancy from './modules/tenancy/index.js'
import { elevators } from './modules/registry/index.js'
import * as billing from './modules/billing/index.js'
import * as callbacks from './modules/callbacks/index.js'
import * as visits from './modules/visits/index.js'
import * as documents from './modules/documents/index.js'
import * as calendar from './modules/calendar/index.js'
import { calendarItems, exportStorageKeys, runFullExport } from './modules/reporting/index.js'
import * as notifications from './modules/notifications/index.js'
import * as repairJobs from './modules/jobs/index.js'
import { listDemoTenantIds, resetDemoTenant } from './demo/reset.js'

/**
 * Scheduled jobs (ARCHITECTURE section 6, D9) - the composition root of the worker. Every cron is
 * catch-up idempotent: it computes the wanted state from the data and only emits what has not
 * been emitted yet (`events.alreadyPublished` / `events.latest` are the dedupe). Times are
 * Europe/Sofia. Per-tenant loops never let one tenant's failure stop the others.
 */
const DAY_MS = 24 * 60 * 60 * 1000

async function forEachTenant<T>(
  job: string,
  fn: (tenant: { id: string; locale: string }) => Promise<T>,
): Promise<Record<string, T | { error: string }>> {
  const out: Record<string, T | { error: string }> = {}
  for (const t of await tenancy.listActiveTenantIds()) {
    try {
      out[t.id] = await fn(t)
    } catch (err) {
      logger.error({ err, job, tenantId: t.id }, 'job failed for tenant')
      out[t.id] = { error: String((err as Error)?.message ?? err).slice(0, 500) }
    }
  }
  return out
}

export function registerJobs(): void {
  defineJob({
    name: 'maintenance.recompute',
    cron: '5 * * * *',
    description:
      'Hourly: refresh nextCheckDueAt of every elevator from lastCheckAt + interval / strategy.',
    handler: () => forEachTenant('maintenance.recompute', (t) => elevators.recomputeSchedule(t.id)),
  })

  defineJob({
    name: 'billing.rollOverdue',
    cron: '10 0 * * *',
    description:
      'Daily 00:10: issued -> overdue when dueAt < today; emits InvoiceOverdue once per invoice.',
    handler: () => forEachTenant('billing.rollOverdue', (t) => billing.rollStatuses(t.id)),
  })

  defineJob({
    name: 'billing.run',
    cron: '0 6 * * *',
    description:
      'Daily 06:00: from tenant.settings.billing.runDay, issues the invoices of the current month for every active contract (idempotent per contract + period).',
    handler: () => forEachTenant('billing.run', (t) => billing.runScheduled(t.id)),
  })

  defineJob({
    name: 'billing.dunning',
    cron: '30 6 * * *',
    description:
      'Daily 06:30: moves open invoices to the dunning stage whose day has come (data-driven stages), applies late fees, emits DunningStageReached.',
    handler: () => forEachTenant('billing.dunning', (t) => billing.runDunning(t.id)),
  })

  defineJob({
    name: 'calendar.materialise',
    cron: '0 6 * * *',
    description:
      'Daily 06:00: emits InspectionDueSoon (alert steps), CheckOverdue (day 1, then weekly) and DefectFollowUpDue (due day, then weekly).',
    handler: () =>
      forEachTenant('calendar.materialise', async (t) => {
        const ctx = systemCtx(t.id, t.locale)
        const today = todayInSofia()
        const settings = await tenancy.getTenantSettings(t.id)
        const steps =
          calendar.rulesFor(settings).alertDaysBefore ?? calendarRules.inspection.alertDaysBefore
        const items = await calendarItems(ctx, {
          from: today,
          to: addDays(today, Math.max(...steps, 7)),
          kinds: ['inspection_due', 'check_overdue', 'defect_follow_up'],
          includeOverdue: true,
        })
        const emitted = { inspectionDueSoon: 0, checkOverdue: 0, defectFollowUpDue: 0 }
        const since = new Date(clock.now().getTime() - DAY_MS)
        for (const it of items.items) {
          if (it.kind === 'inspection_due') {
            if (!steps.includes(it.inDays)) continue
            const last = await events.latest('InspectionDueSoon', it.elevatorId)
            if (last && last.payload.dueAt === it.dueAt && last.payload.inDays === it.inDays)
              continue
            await events.publish(
              { tenantId: t.id },
              {
                type: 'InspectionDueSoon',
                aggregateType: 'elevator',
                aggregateId: it.elevatorId,
                payload: {
                  elevatorId: it.elevatorId,
                  buildingId: it.buildingId,
                  dueAt: it.dueAt,
                  inDays: it.inDays,
                },
              },
            )
            emitted.inspectionDueSoon++
          } else if (it.kind === 'check_overdue') {
            const overdueDays = -it.inDays
            if (overdueDays < 1 || (overdueDays !== 1 && overdueDays % 7 !== 0)) continue
            if (await events.alreadyPublished('CheckOverdue', it.elevatorId, since)) continue
            await events.publish(
              { tenantId: t.id },
              {
                type: 'CheckOverdue',
                aggregateType: 'elevator',
                aggregateId: it.elevatorId,
                payload: {
                  elevatorId: it.elevatorId,
                  buildingId: it.buildingId,
                  dueAt: it.dueAt,
                  overdueDays,
                },
              },
            )
            emitted.checkOverdue++
          } else if (it.kind === 'defect_follow_up') {
            const overdueDays = -it.inDays
            if (overdueDays < 0 || (overdueDays !== 0 && overdueDays % 7 !== 0)) continue
            if (await events.alreadyPublished('DefectFollowUpDue', it.refId, since)) continue
            await events.publish(
              { tenantId: t.id },
              {
                type: 'DefectFollowUpDue',
                aggregateType: 'defect',
                aggregateId: it.refId,
                payload: {
                  elevatorId: it.elevatorId,
                  buildingId: it.buildingId,
                  dueAt: it.dueAt,
                  overdueDays,
                },
              },
            )
            emitted.defectFollowUpDue++
          }
        }
        return emitted
      }),
  })

  defineJob({
    name: 'callbacks.slaWatch',
    cron: '* * * * *',
    description:
      'Every minute: CallbackSlaAtRisk at 75 % of the limit (45 min of 60) and CallbackSlaBreached at the limit, once per callback.',
    handler: () =>
      forEachTenant('callbacks.slaWatch', async (t) => {
        const now = clock.now()
        const emitted = { atRisk: 0, breached: 0 }
        for (const c of await callbacks.listOpenRows(t.id)) {
          const state = callbacks.slaState(c, now)
          const elapsedMinutes = callbacks.elapsedMinutes(c, now)
          if (state === 'ok') continue
          const type = state === 'breached' ? 'CallbackSlaBreached' : 'CallbackSlaAtRisk'
          if (await events.alreadyPublished(type, c.id)) continue
          await events.publish(
            { tenantId: t.id },
            {
              type,
              aggregateType: 'callback',
              aggregateId: c.id,
              payload: {
                elevatorId: c.elevatorId,
                buildingId: c.buildingId,
                elapsedMinutes,
                slaMinutes: c.slaMinutes,
              },
            },
          )
          if (state === 'breached') emitted.breached++
          else emitted.atRisk++
        }
        return emitted
      }),
  })

  defineJob({
    name: 'documents.retentionSweep',
    cron: '0 3 * * 0',
    description:
      'Weekly (Sun 03:00): purge photos of visits older than tenant.settings.retentionYears (visits kept, photosPurgedAt set).',
    handler: () =>
      forEachTenant('documents.retentionSweep', async (t) => {
        const settings = await tenancy.getTenantSettings(t.id)
        const cutoff = documents.retentionCutoff(clock.now(), settings.retentionYears)
        if (!cutoff) return { skipped: true }
        const ids = await visits.listForRetention(t.id, cutoff)
        if (ids.length === 0) return { visits: 0 }
        const purged = await documents.purgeVisitPhotos(t.id, ids)
        const flagged = await visits.markPhotosPurged(t.id, ids, clock.now())
        return { visits: flagged, ...purged }
      }),
  })

  defineJob({
    name: 'attachments.cleanupOrphans',
    cron: '30 3 * * 0',
    description: 'Weekly (Sun 03:30): delete uploads older than 7 days that no visit references.',
    handler: () =>
      forEachTenant('attachments.cleanupOrphans', (t) =>
        documents.cleanupOrphans(
          t.id,
          new Date(clock.now().getTime() - documents.ORPHAN_GRACE_DAYS * DAY_MS),
        ),
      ),
  })

  defineJob({
    name: 'tenancy.deletionSweep',
    cron: '30 3 * * *',
    description:
      'Daily 03:30: hard-delete every tenant whose 30-day deletion grace ended (tables + files), one platform audit line each.',
    handler: async () => {
      const purged: string[] = []
      for (const t of await tenancy.listDueForDeletion()) {
        try {
          const keys = [
            ...(await documents.storageKeysOf(t.id)),
            ...(await exportStorageKeys(t.id)),
          ]
          await purgeTenantData(t.id, keys, `owner request, scheduled ${t.deletionAt ?? ''}`)
          purged.push(t.id)
        } catch (err) {
          logger.error({ err, tenantId: t.id }, 'tenant purge failed')
        }
      }
      return { purged }
    },
  })

  defineJob({
    name: 'tenancy.demoReset',
    cron: '0 4 * * *',
    description:
      'Daily 04:00: tenants with features.demoMode - operational data deleted and regenerated from the demo generator (audit entry).',
    handler: async () => {
      const out: Record<string, unknown> = {}
      for (const id of await listDemoTenantIds()) {
        try {
          const r = await resetDemoTenant(id, { note: 'nightly reset' })
          out[id] = { files: r.files, ...r.generated.counts }
        } catch (err) {
          logger.error({ err, tenantId: id }, 'demo reset failed')
          out[id] = { error: String((err as Error)?.message ?? err).slice(0, 500) }
        }
      }
      return out
    },
  })

  defineJob({
    name: 'jobs.approvalReminders',
    cron: '0 7 * * *',
    description:
      'Daily 07:00: repair jobs awaiting approval longer than tenant.settings.jobs.approvalReminderDays get an in-app reminder for the office (once a week per job).',
    handler: () =>
      forEachTenant('jobs.approvalReminders', (t) => repairJobs.remindApprovals(t.id, t.locale)),
  })

  defineJob({
    name: 'events.sweep',
    cron: '*/5 * * * *',
    description:
      'Every 5 min: re-enqueue deliveries missing for events of the last 24 h (outbox catch-up).',
    handler: async () => ({
      ...(await events.sweep(24)),
      requeuedNotifications: await notifications.requeueStuck(10),
    }),
  })

  defineJob<{ id: string; tenantId: string }>({
    name: 'exports.full',
    description:
      'Queue: builds the full tenant export zip (CSV per dataset, photos, audit, README) and notifies the requester.',
    retryLimit: 1,
    expireInSeconds: 30 * 60,
    handler: (data) => runFullExport(data.tenantId, data.id),
  })
}
