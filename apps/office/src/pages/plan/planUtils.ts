import type {
  DayBoardDto,
  DayPlanDto,
  PlanStopDto,
  PlanStopKind,
  UnplannedStopDto,
  UpdateDayPlanBody,
} from '@avroleva/contracts'
import { todaySofia, tomorrowSofia } from '../../lib/dates'

const SOFIA = 'Europe/Sofia'

/** The current hour (0-23) in Sofia, whatever the browser's zone. */
export function sofiaHour(now = new Date()): number {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: SOFIA, hour: 'numeric', hour12: false }).format(
      now,
    ),
  )
  // Some engines print midnight as "24" with hour12:false.
  return Number.isFinite(h) ? h % 24 : now.getHours()
}

/** The office plans the next day in the afternoon: tomorrow after 15:00 Sofia time, else today. */
export function defaultPlanDate(): string {
  return sofiaHour() >= 15 ? tomorrowSofia() : todaySofia()
}

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: SOFIA,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** ISO date-time -> "HH:MM" in Sofia ("" when missing or unparsable). */
export function sofiaTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d)
}

export type StopInput = NonNullable<UpdateDayPlanBody['stops']>[number]

/** The whole ordered list as PATCH /day-plans/:id wants it (order = index, every field kept). */
export function toStopInputs(stops: PlanStopDto[]): StopInput[] {
  return stops.map((s, i) => ({
    id: s.id,
    kind: s.kind,
    refId: s.refId,
    elevatorId: s.elevatorId,
    buildingId: s.buildingId,
    order: i,
    plannedAt: s.plannedAt ?? null,
    status: s.status,
    completedAt: s.completedAt ?? null,
    manual: s.manual ?? false,
    notes: s.notes ?? null,
  }))
}

/** A stop from the unplanned list as a new (manual) entry of a plan. */
export function unplannedToInput(u: UnplannedStopDto): StopInput {
  return {
    kind: u.kind,
    refId: u.refId,
    elevatorId: u.elevatorId,
    buildingId: u.buildingId,
    manual: true,
    plannedAt: u.plannedAt,
  }
}

/** Moves list[from] so that it ends up at index `to` of the result. */
export function moveIndex<T>(list: T[], from: number, to: number): T[] {
  const out = [...list]
  const [item] = out.splice(from, 1)
  if (item === undefined) return list
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item)
  return out
}

/** Re-numbers `order` after a local reorder (the API does the same on save). */
export function renumber(stops: PlanStopDto[]): PlanStopDto[] {
  return stops.map((s, i) => (s.order === i ? s : { ...s, order: i }))
}

/** The board with these plans and its totals recomputed exactly as the API computes them. */
export function withPlans(board: DayBoardDto, plans: DayPlanDto[]): DayBoardDto {
  const elevatorIds = new Set(plans.flatMap((p) => p.stops.map((s) => s.elevatorId)))
  return {
    ...board,
    plans,
    totals: {
      stops: plans.reduce((n, p) => n + p.stops.length, 0),
      elevators: elevatorIds.size,
      estKm: Math.round(plans.reduce((n, p) => n + p.totals.estKm, 0) * 10) / 10,
      plans: plans.length,
      published: plans.filter((p) => p.status === 'published').length,
    },
  }
}

/** Identity of a due item (the plan stores it as kind + refId; ids exist only inside a plan). */
export const unplannedKey = (u: { kind: PlanStopKind; refId: string }) => `${u.kind}:${u.refId}`

// ---- drag and drop (plain HTML5) -------------------------------------------------------------

export const DRAG_MIME = 'application/x-avroleva-plan-stop'

export type DragPayload =
  { type: 'stop'; planId: string; stopId: string } | { type: 'unplanned'; item: UnplannedStopDto }

/** Drop target: a plan's column, or `null` for the "Непланирани" column (= remove from the plan). */
export interface DropHint {
  planId: string | null
  index: number
}

export function readPayload(dt: DataTransfer): DragPayload | null {
  try {
    const raw = dt.getData(DRAG_MIME)
    if (!raw) return null
    const p = JSON.parse(raw) as DragPayload
    if (p.type === 'stop' && typeof p.planId === 'string' && typeof p.stopId === 'string') return p
    if (p.type === 'unplanned' && p.item && typeof p.item.refId === 'string') return p
    return null
  } catch {
    return null
  }
}
