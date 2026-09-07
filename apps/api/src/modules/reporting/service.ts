import type { DashboardDto, DashboardPinDto } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { addDays, toDateOnly, todayInSofia } from '../../platform/clock.js'
import { elevators } from '../registry/index.js'
import { dueState } from '../maintenance/index.js'
import { summary } from '../billing/index.js'

/**
 * Dashboard = one registry read model query (elevators + buildings + contacts) and the billing
 * summary (two aggregates). No per-pin queries.
 */
export async function dashboard(ctx: Ctx): Promise<DashboardDto> {
  const today = todayInSofia()
  const tomorrow = addDays(today, 1)
  const [rows, money] = await Promise.all([
    elevators.listForSchedule(ctx.tenantId),
    summary(ctx.tenantId),
  ])
  const counts = {
    elevators: 0,
    overdue: 0,
    today: 0,
    tomorrow: 0,
    soon: 0,
    ok: 0,
    stopped: 0,
    none: 0,
    buildingsOnMap: 0,
    buildingsWithoutCoordinates: 0,
  }
  const onMap = new Set<string>()
  const noCoords = new Set<string>()
  const pins: DashboardPinDto[] = []
  for (const r of rows) {
    counts.elevators++
    const next = toDateOnly(r.nextCheckDueAt)
    const state = dueState(next, r.status, today)
    counts[state]++
    if (next === tomorrow && r.status === 'active') counts.tomorrow++
    if (r.building.lat == null || r.building.lng == null) {
      noCoords.add(r.buildingId)
      continue
    }
    onMap.add(r.buildingId)
    pins.push({
      elevatorId: r.id,
      buildingId: r.buildingId,
      lat: r.building.lat,
      lng: r.building.lng,
      label: `${r.building.addressText} · ${r.internalNo}`,
      addressText: r.building.addressText,
      internalNo: r.internalNo,
      status: r.status,
      state,
      nextCheckDueAt: next,
    })
  }
  counts.buildingsOnMap = onMap.size
  counts.buildingsWithoutCoordinates = noCoords.size
  return {
    today,
    counts,
    money: {
      pendingCents: money.pendingCents,
      pendingCount: money.pendingCount,
      overdueCents: money.overdueCents,
      overdueCount: money.overdueCount,
      paidThisMonthCents: money.paidThisMonthCents,
    },
    pins,
  }
}
