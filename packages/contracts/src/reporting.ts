import type { ElevatorStatus } from './enums.js'
import type { DueState } from './maintenance.js'

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
  pins: DashboardPinDto[]
}
