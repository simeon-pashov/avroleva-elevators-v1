import { events } from './platform/events/bus.js'
import { logger } from './platform/logger.js'

/**
 * Event subscribers are registered here, never inside the emitting module (ARCHITECTURE A8).
 * Step 2 attaches `maintenance` here: ElevatorRegistered / ElevatorStatusChanged /
 * ContractTerminated -> ensure or cancel the open functional-check job.
 */
export function registerSubscribers(): void {
  for (const type of [
    'ElevatorRegistered',
    'ElevatorStatusChanged',
    'ContractStarted',
    'ContractTerminated',
    'TenantCreated',
  ]) {
    events.subscribe(type, (e) => {
      logger.debug(
        { type: e.type, aggregateId: e.aggregateId, tenantId: e.tenantId },
        'domain event',
      )
    })
  }
}
