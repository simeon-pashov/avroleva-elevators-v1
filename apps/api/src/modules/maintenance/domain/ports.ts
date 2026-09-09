/**
 * Ports of the maintenance module (ARCHITECTURE section 1.1 rule 2): the day plan reads what
 * the other L3 modules (callbacks, jobs, calendar) hold for a day through this interface, which
 * `wiring.ts` implements with their public functions. Maintenance never imports them.
 */
export interface PlanSourceCallback {
  id: string
  elevatorId: string
  buildingId: string
  description: string
  status: string
  assignedUserId: string | null
}

export interface PlanSourceJob {
  id: string
  elevatorId: string
  buildingId: string
  title: string
  status: string
  scheduledAt: Date | null
  assignedUserIds: string[]
}

export interface PlanSourceInspection {
  id: string
  elevatorId: string
  buildingId: string
  /** YYYY-MM-DD or null. */
  scheduledAt: string | null
  result: string
}

export interface PlanSources {
  /** Every callback that is not closed (the caller filters the statuses it plans). */
  openCallbacks(tenantId: string): Promise<PlanSourceCallback[]>
  /** One callback by id (closed ones included), or null. */
  callback(tenantId: string, id: string): Promise<PlanSourceCallback | null>
  /** Scheduled / in-progress jobs with scheduledAt in [from, to) plus the listed ids. */
  jobsForPlanning(
    tenantId: string,
    q: { from: Date; to: Date; ids?: string[] },
  ): Promise<PlanSourceJob[]>
  /** Inspections with a scheduled date that were not performed yet. */
  scheduledInspections(tenantId: string): Promise<PlanSourceInspection[]>
  /** One inspection by id, or null. */
  inspection(tenantId: string, id: string): Promise<PlanSourceInspection | null>
}

let sources: PlanSources | null = null

export function usePlanSources(impl: PlanSources): void {
  sources = impl
}

export function planSources(): PlanSources {
  if (!sources) throw new Error('maintenance: PlanSources port not wired (see wiring.ts)')
  return sources
}
