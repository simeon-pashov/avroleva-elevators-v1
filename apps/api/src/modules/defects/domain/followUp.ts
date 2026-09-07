import { addDays, dateOnlyInSofia } from '../../../platform/clock.js'
import type { DefectStatus } from '@avroleva/contracts'

/**
 * Follow-up date = the day the defect was recorded (Sofia wall clock) + N days, N from
 * tenant.settings.defectFollowUpDays (default 30). An office to-do "open for N days without the
 * building's go-ahead" - nothing more (ARCHITECTURE section 3).
 */
export function followUpDueAt(recordedAt: Date, followUpDays: number): string {
  return addDays(dateOnlyInSofia(recordedAt), followUpDays)
}

const ORDER: Record<DefectStatus, number> = {
  open: 0,
  notified: 1,
  awaiting_approval: 2,
  scheduled: 3,
  resolved: 4,
}

/**
 * Status may move forward or back between the four open states (a scheduled repair can fall back
 * to awaiting approval); `resolved` is terminal.
 */
export function canChangeStatus(from: DefectStatus, to: DefectStatus): boolean {
  if (from === 'resolved') return false
  return ORDER[to] !== undefined
}

export const OPEN_DEFECT_STATUSES: readonly DefectStatus[] = [
  'open',
  'notified',
  'awaiting_approval',
  'scheduled',
]
