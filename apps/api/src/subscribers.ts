import { events } from './platform/events/bus.js'
import { logger } from './platform/logger.js'
import { elevators } from './modules/registry/index.js'

/**
 * Event subscribers are registered here, never inside the emitting module (ARCHITECTURE A8).
 * - TenantSettingsChanged (tenancy, L1) -> registry recomputes every elevator's nextCheckDueAt
 *   (interval / cycle strategy). L1 cannot call L2, so this is the only path.
 * - The rest are logged; maintenance jobs / notifications attach here in later steps.
 */
export function registerSubscribers(): void {
  events.subscribe('TenantSettingsChanged', async (e) => {
    if (!e.tenantId) return
    const changed = await elevators.recomputeSchedule(e.tenantId)
    logger.info({ tenantId: e.tenantId, changed }, 'schedule recomputed after settings change')
  })
  for (const type of [
    'ElevatorRegistered',
    'ElevatorStatusChanged',
    'ContractStarted',
    'ContractTerminated',
    'TenantCreated',
    'VisitRecorded',
    'VisitAmended',
    'InvoiceIssued',
    'PaymentRecorded',
    'CallbackOpened',
    'CallbackDispatched',
    'CallbackOnSite',
    'CallbackReleased',
    'CallbackRestored',
    'CallbackClosed',
    'DefectRecorded',
    'StopLiftRequired',
    'DefectResolved',
    'InspectionRecorded',
    'AlarmDeviceTested',
  ]) {
    events.subscribe(type, (e) => {
      logger.debug(
        { type: e.type, aggregateId: e.aggregateId, tenantId: e.tenantId },
        'domain event',
      )
    })
  }
}
