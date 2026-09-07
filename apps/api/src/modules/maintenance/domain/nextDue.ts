import type { DueState } from '@avroleva/contracts'
import { addDays } from '../../../platform/clock.js'

/**
 * The 30-day cycle engine (ARCHITECTURE A3, MVP-PLAN phase 2), as a pure function over date-only
 * strings (YYYY-MM-DD). Date-only arithmetic is done in UTC on purpose: a "day" in the office's
 * calendar never shifts with a DST change in Europe/Sofia (see the unit tests around 2026-03-29
 * and 2026-10-25). "Today" is derived elsewhere from the Sofia wall clock.
 *
 * Strategies (tenant.settings.cycleStrategy):
 * - `rolling`         next = lastCheckAt + intervalDays.
 * - `calendar_month`  the check must happen within a calendar month: next = the last day of the
 *                     month that is floor(intervalDays / 30) months (min 1) after the month of
 *                     lastCheckAt. Intervals shorter than 28 days fall back to rolling (a
 *                     "calendar month" makes no sense for a 10- or 15-day cycle).
 * - `overrideAt`      a one-off reschedule ("Премести за утре") always wins; the registry clears
 *                     it when a check visit is recorded.
 * - never checked     null (the office sees "няма проверка" and the elevator is not on the board).
 */
export type CycleStrategy = 'rolling' | 'calendar_month'

export interface NextDueInput {
  lastCheckAt: string | null
  intervalDays: number
  overrideAt: string | null
  strategy: CycleStrategy
}

export function nextDue(input: NextDueInput): string | null {
  if (input.overrideAt) return input.overrideAt
  if (!input.lastCheckAt) return null
  const interval = Math.max(1, Math.floor(input.intervalDays))
  if (input.strategy === 'calendar_month' && interval >= 28) {
    const months = Math.max(1, Math.floor(interval / 30))
    return endOfMonth(addMonths(input.lastCheckAt, months))
  }
  return addDays(input.lastCheckAt, interval)
}

/** Same day N months later; the day is clamped to the target month's length (Jan 31 -> Feb 28). */
export function addMonths(dateOnly: string, months: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = daysInMonth(first.getUTCFullYear(), first.getUTCMonth())
  first.setUTCDate(Math.min(d, lastDay))
  return first.toISOString().slice(0, 10)
}

export function endOfMonth(dateOnly: string): string {
  const [y, m] = dateOnly.split('-').map(Number) as [number, number]
  const last = daysInMonth(y, m - 1)
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** Whole days from `from` to `to` (date-only strings); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000)
}

export const SOON_DAYS = 7

/**
 * Colour of a pin / row. Stopped lifts are shown as such whatever their date; lifts out of
 * contract or scrapped and lifts never checked have no due state.
 */
export function dueState(nextDueAt: string | null, status: string, today: string): DueState {
  if (status === 'stopped_by_firm' || status === 'stopped_by_authority') return 'stopped'
  if (status === 'out_of_contract' || status === 'scrapped') return 'none'
  if (!nextDueAt) return 'none'
  const diff = daysBetween(today, nextDueAt)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= SOON_DAYS) return 'soon'
  return 'ok'
}
