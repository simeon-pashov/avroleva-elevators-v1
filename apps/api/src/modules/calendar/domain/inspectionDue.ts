import { calendarRules } from '@avroleva/domain-data'
import type { TenantSettings } from '@avroleva/contracts'
import type { CalendarSeverity } from '@avroleva/contracts'

export interface InspectionRules {
  periodicIntervalMonths: number
  firstIntervalMonths: number
  alertDaysBefore: number[]
  alarmTestIntervalMonths: number | null
}

/** Shipped defaults (packages/domain-data/calendar-rules.json) overridden per tenant (A6). */
export function rulesFor(settings: Partial<TenantSettings> | null | undefined): InspectionRules {
  const s = settings ?? {}
  return {
    periodicIntervalMonths:
      s.inspectionIntervalMonths ?? calendarRules.inspection.periodicIntervalMonths,
    firstIntervalMonths:
      s.firstInspectionIntervalMonths ?? calendarRules.inspection.firstIntervalMonths,
    alertDaysBefore: s.inspectionAlertDays ?? calendarRules.inspection.alertDaysBefore,
    alarmTestIntervalMonths: s.alarmTestIntervalMonths ?? calendarRules.alarmTestIntervalMonths,
  }
}

/** Date-only month arithmetic in UTC; clamps to the last day of the target month (31 Jan + 1 = 28/29 Feb). */
export function addMonthsDateOnly(dateOnly: string, months: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, last))
  return target.toISOString().slice(0, 10)
}

/**
 * Next due date after an inspection: performedAt + periodic interval, for any result but `failed`
 * (a failed inspection has no "next" until it is passed) and `pending` (nothing was done yet).
 * The first inspection of a new lift uses the longer interval - the caller says which.
 */
export function nextInspectionDue(
  performedAt: string | null,
  result: 'passed' | 'passed_with_defects' | 'failed' | 'pending',
  rules: InspectionRules,
  first = false,
): string | null {
  if (!performedAt) return null
  if (result === 'failed' || result === 'pending') return null
  return addMonthsDateOnly(
    performedAt,
    first ? rules.firstIntervalMonths : rules.periodicIntervalMonths,
  )
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

/** overdue (< today) | due (today .. the smallest alert offset) | upcoming (later). */
export function severityOf(dueAt: string, today: string, rules: InspectionRules): CalendarSeverity {
  const diff = daysBetween(today, dueAt)
  if (diff < 0) return 'overdue'
  const nearest = Math.min(...rules.alertDaysBefore, 7)
  return diff <= nearest ? 'due' : 'upcoming'
}
