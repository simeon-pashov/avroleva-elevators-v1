import type { ElevatorStatus } from './enums.js'
import type { DueState } from './maintenance.js'
import type { CallbacksSummaryDto } from './callbacks.js'
import type { DefectsSummaryDto } from './defects.js'
import type { CalendarItemKind } from './calendar.js'

export interface DashboardPinDto {
  elevatorId: string
  buildingId: string
  lat: number
  lng: number
  /** "<address> · <internalNo>" */
  label: string
  addressText: string
  internalNo: string
  status: ElevatorStatus
  state: DueState
  nextCheckDueAt: string | null
  /** An open stop-lift defect is recorded for this elevator. */
  stopLift: boolean
  openCallbacks: number
}

export interface DashboardDto {
  today: string
  counts: {
    elevators: number
    overdue: number
    today: number
    tomorrow: number
    soon: number
    ok: number
    stopped: number
    none: number
    /** Buildings that have coordinates and at least one pin. */
    buildingsOnMap: number
    buildingsWithoutCoordinates: number
  }
  money: {
    pendingCents: number
    pendingCount: number
    overdueCents: number
    overdueCount: number
    paidThisMonthCents: number
  }
  callbacks: CallbacksSummaryDto
  defects: DefectsSummaryDto
  /** Deadlines strip: items due in the next 30 days (and overdue) per kind. */
  deadlines: {
    days: number
    overdue: number
    total: number
    byKind: Record<CalendarItemKind, number>
  }
  /** Compact "this month" strip: visits recorded, callbacks received, average response. */
  thisMonth: {
    period: string
    visits: number
    callbacks: number
    avgResponseMinutes: number | null
  }
  pins: DashboardPinDto[]
}
