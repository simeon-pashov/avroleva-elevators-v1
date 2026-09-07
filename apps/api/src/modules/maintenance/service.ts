import type { DueBoardDto, DueBuildingDto, DueElevatorDto, ElevatorDto } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { addDays, toDateOnly, todayInSofia } from '../../platform/clock.js'
import { AppError } from '../../platform/http/errors.js'
import { elevators } from '../registry/index.js'
import type { ElevatorDetailRow } from '../registry/index.js'
import { daysBetween, dueState } from './domain/nextDue.js'

/**
 * Due board: elevators to check on a given day (default today) plus everything overdue, grouped
 * by building with the house-manager phone inline. One registry query, no N+1.
 */
export async function dueBoard(ctx: Ctx, date?: string): Promise<DueBoardDto> {
  const today = todayInSofia()
  const day = date ?? today
  const tomorrow = addDays(today, 1)
  const rows = await elevators.listForSchedule(ctx.tenantId)

  const due = new Map<string, DueBuildingDto>()
  const overdue = new Map<string, DueBuildingDto>()
  const counts = { overdue: 0, today: 0, tomorrow: 0 }

  for (const r of rows) {
    if (r.status !== 'active') continue
    const next = toDateOnly(r.nextCheckDueAt)
    if (!next) continue
    const state = dueState(next, r.status, today)
    if (state === 'overdue') counts.overdue++
    if (next === today) counts.today++
    if (next === tomorrow) counts.tomorrow++
    const row = toDueRow(r, next, day, today)
    if (next < today) push(overdue, r, row)
    else if (next === day) push(due, r, row)
  }
  return {
    date: day,
    today,
    due: [...due.values()],
    overdue: [...overdue.values()],
    counts,
  }
}

/** "Премести за утре": one-off override of the next check date; cleared by the next visit. */
export async function reschedule(
  ctx: Ctx,
  elevatorId: string,
  toDate: string | null,
): Promise<ElevatorDto> {
  if (toDate && toDate < todayInSofia()) throw new AppError(400, 'maintenance.rescheduleInPast')
  return elevators.setCheckOverride(ctx, elevatorId, toDate)
}

function toDueRow(r: ElevatorDetailRow, next: string, day: string, today: string): DueElevatorDto {
  return {
    elevatorId: r.id,
    internalNo: r.internalNo,
    regNo: r.regNo,
    status: r.status,
    lastCheckAt: toDateOnly(r.lastCheckAt),
    nextCheckDueAt: next,
    nextCheckOverrideAt: toDateOnly(r.nextCheckOverrideAt),
    daysOverdue: Math.max(0, daysBetween(next, day)),
    state: dueState(next, r.status, today),
  }
}

function push(map: Map<string, DueBuildingDto>, r: ElevatorDetailRow, row: DueElevatorDto) {
  let g = map.get(r.buildingId)
  if (!g) {
    const contact =
      r.building.contacts.find((c) => c.role === 'house_manager') ?? r.building.contacts[0] ?? null
    g = {
      buildingId: r.buildingId,
      addressText: r.building.addressText,
      lat: r.building.lat,
      lng: r.building.lng,
      customerName: r.building.customer?.name ?? null,
      contact: contact ? { name: contact.name, phone: contact.phone } : null,
      elevators: [],
    }
    map.set(r.buildingId, g)
  }
  g.elevators.push(row)
}
