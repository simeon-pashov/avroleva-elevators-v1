import { z } from 'zod'
import type { ElevatorStatus } from './enums.js'
import { isoDate } from './common.js'

/**
 * Due state of an elevator's next functional check (maintenance module, ARCHITECTURE A3).
 * overdue: due < today · today · soon: within the next 7 days · ok: later · stopped: elevator not
 * in service (stopped_by_firm / stopped_by_authority) · none: never checked or not in contract.
 */
export const DueState = z.enum(['overdue', 'today', 'soon', 'ok', 'stopped', 'none'])
export type DueState = z.infer<typeof DueState>

export const dueQuery = z.object({
  /** Day to list (YYYY-MM-DD, Europe/Sofia). Default: today. */
  date: isoDate.optional(),
})
export type DueQuery = z.infer<typeof dueQuery>

export const rescheduleBody = z.object({
  /** New one-off due date (YYYY-MM-DD); null clears the override. */
  toDate: isoDate.nullable(),
})
export type RescheduleBody = z.infer<typeof rescheduleBody>

export interface DueElevatorDto {
  elevatorId: string
  internalNo: string
  regNo: string | null
  status: z.infer<typeof ElevatorStatus>
  lastCheckAt: string | null
  nextCheckDueAt: string | null
  nextCheckOverrideAt: string | null
  /** Positive when overdue relative to the requested date. */
  daysOverdue: number
  state: DueState
}

export interface DueBuildingDto {
  buildingId: string
  addressText: string
  lat: number | null
  lng: number | null
  customerName: string | null
  contact: { name: string; phone: string | null } | null
  elevators: DueElevatorDto[]
}

export interface DueBoardDto {
  /** The requested day. */
  date: string
  today: string
  /** Elevators due exactly on `date`, grouped by building. */
  due: DueBuildingDto[]
  /** Elevators overdue relative to today (always returned, whatever `date` is). */
  overdue: DueBuildingDto[]
  counts: { overdue: number; today: number; tomorrow: number }
}
