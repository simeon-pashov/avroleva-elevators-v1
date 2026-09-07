import { addDays } from '../../../platform/clock.js'

/**
 * Per-elevator interval with the tenant default (ARCHITECTURE A3). The full cycle engine
 * (`nextDue(lastDone, elevator, settings)` with rolling vs calendar-month strategy, job generation)
 * belongs to the maintenance module in step 2; the registry only exposes the denormalised hint.
 */
export function effectiveIntervalDays(
  elevator: { checkIntervalDays: number | null },
  settings: { checkIntervalDays: number },
): number {
  return elevator.checkIntervalDays ?? settings.checkIntervalDays
}

export function nextCheckDue(lastCheckAt: string | null, intervalDays: number): string | null {
  return lastCheckAt ? addDays(lastCheckAt, intervalDays) : null
}
