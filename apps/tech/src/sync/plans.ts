import type {
  DayPlanDto,
  PlanStopDto,
  PlanStopEventPayload,
  PlanStopKind,
} from '@avroleva/contracts'
import type { OutboxRow } from '../db'
import { db } from '../db'
import { todayInSofia } from '../lib/dates'
import type { StopOutcome } from '../lib/plans'
import { withStopStatus } from '../lib/plans'
import { buildOutboxRow, requestDrain } from './outbox'
import { deviceTime } from './state'

type DeviceTime = ReturnType<typeof deviceTime>

function planStopRow(
  plan: DayPlanDto,
  stop: PlanStopDto,
  status: StopOutcome,
  dt: DeviceTime,
): OutboxRow {
  const payload: PlanStopEventPayload = {
    planId: plan.id,
    stopId: stop.id,
    status,
    ...dt,
    notes: null,
  }
  return buildOutboxRow({ kind: 'plan.stop', payload, elevatorId: stop.elevatorId })
}

/**
 * "Готово" / "Пропусни" on a stop of my plan: the outbox item and the local plan flipped in one
 * transaction, then a drain. Idempotent - a stop already in that state enqueues nothing.
 */
export async function markPlanStop(
  planId: string,
  stopId: string,
  status: StopOutcome,
): Promise<boolean> {
  const dt = deviceTime()
  let changed = false
  await db.transaction('rw', [db.dayPlans, db.outbox], async () => {
    const plan = await db.dayPlans.get(planId)
    const stop = plan?.stops.find((s) => s.id === stopId)
    if (!plan || !stop || stop.status === status) return
    await db.outbox.add(planStopRow(plan, stop, status, dt))
    await db.dayPlans.put(withStopStatus(plan, stopId, status, dt.at))
    changed = true
  })
  if (changed) void requestDrain()
  return changed
}

export interface StopMatch {
  kind: PlanStopKind
  /** check: elevatorId · callback: callbackId · job: jobId (see PlanStop.refId). */
  refId?: string
  elevatorId?: string
}

/**
 * Work recorded on this phone completes the matching stop(s) of today's plan by itself: a check
 * visit, a job completion, a restored callback. Call INSIDE the caller's transaction (which must
 * include `db.dayPlans` and `db.outbox`) so the plan flips together with the work it reflects.
 * Returns how many stops were marked; a stop already done enqueues nothing.
 */
export async function completePlanStops(
  match: StopMatch,
  dt: DeviceTime = deviceTime(),
): Promise<number> {
  const plans = await db.dayPlans.where('date').equals(todayInSofia()).toArray()
  let n = 0
  for (const plan of plans) {
    let next = plan
    for (const stop of plan.stops) {
      if (stop.kind !== match.kind || stop.status === 'done') continue
      if (match.refId !== undefined && stop.refId !== match.refId) continue
      if (match.elevatorId !== undefined && stop.elevatorId !== match.elevatorId) continue
      await db.outbox.add(planStopRow(plan, stop, 'done', dt))
      next = withStopStatus(next, stop.id, 'done', dt.at)
      n += 1
    }
    if (next !== plan) await db.dayPlans.put(next)
  }
  return n
}
