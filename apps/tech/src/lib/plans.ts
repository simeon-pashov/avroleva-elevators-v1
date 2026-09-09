import type { DayPlanDto, PlanStopDto, PlanStopEventPayload } from '@avroleva/contracts'

/** What the phone can report about a stop (`plan.stop` push). */
export type StopOutcome = PlanStopEventPayload['status']

/** Stops in the order the office planned them. */
export function orderedStops(plan: DayPlanDto): PlanStopDto[] {
  return [...plan.stops].sort((a, b) => a.order - b.order)
}

/** The plan with one stop flipped; `totals.done` follows. */
export function withStopStatus(
  plan: DayPlanDto,
  stopId: string,
  status: StopOutcome,
  at: string,
): DayPlanDto {
  const stops = plan.stops.map((s) =>
    s.id === stopId
      ? { ...s, status, completedAt: status === 'done' ? at : (s.completedAt ?? null) }
      : s,
  )
  return {
    ...plan,
    stops,
    totals: { ...plan.totals, done: stops.filter((s) => s.status === 'done').length },
  }
}

/**
 * Re-applies what this phone recorded (pending `plan.stop` outbox items, oldest first) over a
 * server copy of the plan: a stop done offline stays done until the server copy confirms it.
 */
export function applyPlanStopEvents(plan: DayPlanDto, events: PlanStopEventPayload[]): DayPlanDto {
  let out = plan
  for (const e of events) {
    if (e.planId !== plan.id) continue
    if (!out.stops.some((s) => s.id === e.stopId && s.status !== e.status)) continue
    out = withStopStatus(out, e.stopId, e.status, e.at)
  }
  return out
}

/** Where a tap on a stop goes: the screen the app already has for that kind of work. */
export function stopRoute(stop: PlanStopDto): string {
  switch (stop.kind) {
    case 'callback':
      return `/callbacks#${stop.refId}`
    case 'job':
      return `/jobs/${stop.refId}`
    default:
      return `/elevators/${stop.elevatorId}`
  }
}
