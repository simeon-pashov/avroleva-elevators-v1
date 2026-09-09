import { events } from './platform/events/bus.js'
import { logger } from './platform/logger.js'
import { elevators } from './modules/registry/index.js'
import * as notifications from './modules/notifications/index.js'
import { getTenant } from './modules/tenancy/index.js'

/**
 * Event subscribers are registered here, never inside the emitting module (ARCHITECTURE A8).
 * Handler names are stable (they key `event_delivery`): renaming one re-delivers old events.
 * - TenantSettingsChanged (tenancy, L1) -> registry recomputes every elevator's nextCheckDueAt.
 * - Every notifiable event -> notifications.handleEvent (the rule table decides what goes out).
 * - TenantDeletionScheduled / Cancelled -> in-app + e-mail confirmation to the owners.
 * - The rest are logged.
 */
let registered = false

export const NOTIFIABLE_EVENTS = [
  'VisitRecorded',
  'CallbackOpened',
  'CallbackClosed',
  'CallbackSlaAtRisk',
  'CallbackSlaBreached',
  'InvoiceIssued',
  'InvoiceOverdue',
  'InspectionDueSoon',
  'DefectFollowUpDue',
  'CheckOverdue',
  'StopLiftRequired',
  'DunningStageReached',
  'PaymentMatched',
  'CreditNoteIssued',
] as const

/** Every (event type, handler name) pair registered below - the seed uses it to acknowledge history. */
export const SUBSCRIPTIONS: ReadonlyArray<{ type: string; name: string }> = [
  { type: 'TenantSettingsChanged', name: 'registry.recomputeSchedule' },
  ...NOTIFIABLE_EVENTS.map((type) => ({ type, name: 'notifications.rules' })),
  { type: 'TenantDeletionScheduled', name: 'notifications.tenantDeletion' },
  { type: 'TenantDeletionCancelled', name: 'notifications.tenantDeletion' },
]

export function registerSubscribers(): void {
  if (registered) return
  registered = true

  events.subscribe(
    'TenantSettingsChanged',
    async (e) => {
      if (!e.tenantId) return
      const changed = await elevators.recomputeSchedule(e.tenantId)
      logger.info({ tenantId: e.tenantId, changed }, 'schedule recomputed after settings change')
    },
    'registry.recomputeSchedule',
  )

  for (const type of NOTIFIABLE_EVENTS) {
    events.subscribe(type, notifications.handleEvent, 'notifications.rules')
  }

  for (const type of ['TenantDeletionScheduled', 'TenantDeletionCancelled']) {
    events.subscribe(
      type,
      async (e) => {
        if (!e.tenantId) return
        const tenant = await getTenant(e.tenantId)
        const key =
          e.type === 'TenantDeletionScheduled'
            ? 'tenant_deletion_scheduled'
            : 'tenant_deletion_cancelled'
        const data = { deletion: { at: e.payload.deletionAt ?? null }, tenant }
        await notifications.notifyUsers(e.tenantId, {
          key,
          roles: ['owner'],
          data,
          relatedType: 'tenant',
          relatedId: e.tenantId,
          link: '/settings/data',
          eventId: e.id,
          eventType: e.type,
        })
        await notifications.notifyUsers(e.tenantId, {
          key,
          roles: ['owner'],
          channel: 'email',
          data,
          relatedType: 'tenant',
          relatedId: e.tenantId,
          eventId: e.id,
          eventType: e.type,
        })
      },
      'notifications.tenantDeletion',
    )
  }

  // Every other event (ElevatorRegistered, PaymentRecorded, ...) has no subscriber yet: it stays in
  // `domain_event` as history and attaches a handler here when a behaviour needs it.
}
