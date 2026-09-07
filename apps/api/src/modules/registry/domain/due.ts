import type { DueState } from '@avroleva/contracts'
import { addDays, toDateOnly, todayInSofia } from '../../../platform/clock.js'

/**
 * Schedule rules port (ARCHITECTURE section 1.1 rule 2): the registry owns the denormalised
 * `elevator.nextCheckDueAt` column but the cycle engine that computes it lives in `maintenance`
 * (L3), which the registry (L2) may not import. The composition root (`app.ts`) injects the
 * maintenance implementation; the default below is the plain rolling rule so the registry stays
 * usable on its own (unit tests, a future replacement of maintenance).
 */
export interface DueInput {
  lastCheckAt: string | null
  intervalDays: number
  overrideAt: string | null
  strategy: 'rolling' | 'calendar_month'
}

export interface ScheduleRules {
  nextDue(input: DueInput): string | null
  dueState(nextDue: string | null, status: string, today: string): DueState
}

const defaultRules: ScheduleRules = {
  nextDue: ({ lastCheckAt, intervalDays, overrideAt }) =>
    overrideAt ?? (lastCheckAt ? addDays(lastCheckAt, intervalDays) : null),
  dueState: (nextDue, status, today) => {
    if (status === 'stopped_by_firm' || status === 'stopped_by_authority') return 'stopped'
    if (!nextDue || status === 'scrapped' || status === 'out_of_contract') return 'none'
    if (nextDue < today) return 'overdue'
    if (nextDue === today) return 'today'
    return nextDue <= addDays(today, 7) ? 'soon' : 'ok'
  },
}

let rules: ScheduleRules = defaultRules

export function useScheduleRules(next: ScheduleRules | null): void {
  rules = next ?? defaultRules
}

/** Per-elevator interval with the tenant default (ARCHITECTURE A3). */
export function effectiveIntervalDays(
  elevator: { checkIntervalDays: number | null },
  settings: { checkIntervalDays: number },
): number {
  return elevator.checkIntervalDays ?? settings.checkIntervalDays
}

export interface ScheduleSettings {
  checkIntervalDays: number
  cycleStrategy: 'rolling' | 'calendar_month'
}

/** Next due date (YYYY-MM-DD) through the injected rules; what gets stored in nextCheckDueAt. */
export function computeNextDue(
  elevator: {
    checkIntervalDays: number | null
    lastCheckAt: Date | string | null
    nextCheckOverrideAt: Date | string | null
  },
  settings: ScheduleSettings,
): string | null {
  return rules.nextDue({
    lastCheckAt: asDateOnly(elevator.lastCheckAt),
    intervalDays: effectiveIntervalDays(elevator, settings),
    overrideAt: asDateOnly(elevator.nextCheckOverrideAt),
    strategy: settings.cycleStrategy,
  })
}

export function dueStateOf(
  nextDue: string | null,
  status: string,
  today: string = todayInSofia(),
): DueState {
  return rules.dueState(nextDue, status, today)
}

/** Kept for callers that only know the interval (legacy hint). */
export function nextCheckDue(lastCheckAt: string | null, intervalDays: number): string | null {
  return rules.nextDue({ lastCheckAt, intervalDays, overrideAt: null, strategy: 'rolling' })
}

function asDateOnly(d: Date | string | null): string | null {
  if (!d) return null
  return typeof d === 'string' ? d.slice(0, 10) : toDateOnly(d)
}
