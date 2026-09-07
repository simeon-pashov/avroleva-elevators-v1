import type {
  AlarmTestDto,
  CreateAlarmTestBody,
  CreateInspectionBody,
  InspectionDefectDto,
  InspectionDto,
  InspectionListQuery,
  Page,
  UpdateInspectionBody,
} from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { addDays, clock, fromDateOnly, toDateOnly } from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { transaction } from '../../platform/db/prisma.js'
import type { Tx } from '../../platform/db/prisma.js'
import { findUsersByIds, getTenantSettings } from '../tenancy/index.js'
import { elevators } from '../registry/index.js'
import * as repo from './repo/calendar.js'
import type { InspectionRow } from './repo/calendar.js'
import { nextInspectionDue, rulesFor } from './domain/inspectionDue.js'

const MAX_FUTURE_MS = 60 * 60 * 1000

function defectsOf(raw: unknown): InspectionDefectDto[] {
  if (!Array.isArray(raw)) return []
  return raw.map((d) => {
    const x = (d ?? {}) as Partial<InspectionDefectDto>
    return { text: String(x.text ?? ''), deadline: x.deadline ?? null, closed: !!x.closed }
  })
}

export function toInspectionDto(i: InspectionRow): InspectionDto {
  return {
    id: i.id,
    elevatorId: i.elevatorId,
    elevatorInternalNo: i.elevator.internalNo,
    buildingId: i.elevator.building.id,
    buildingAddressText: i.elevator.building.addressText,
    kind: i.kind,
    requestedAt: toDateOnly(i.requestedAt),
    scheduledAt: toDateOnly(i.scheduledAt),
    performedAt: toDateOnly(i.performedAt),
    result: i.result,
    inspectionBody: i.inspectionBody,
    nextDueAt: toDateOnly(i.nextDueAt),
    notes: i.notes,
    defects: defectsOf(i.defects),
    createdByUserId: i.createdByUserId,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  }
}

/**
 * Resolves nextDueAt: an explicit value wins; otherwise performedAt + the tenant's interval (first
 * inspection of the lift = the longer interval), null for failed / pending.
 */
async function resolveNextDue(
  tenantId: string,
  elevatorId: string,
  input: { performedAt: string | null; result: InspectionDto['result']; nextDueAt?: string | null },
  excludeId: string | null,
  tx: Tx,
): Promise<string | null> {
  if (input.nextDueAt !== undefined) return input.nextDueAt
  const settings = await getTenantSettings(tenantId)
  const performedBefore = await repo.countPerformed(tenantId, elevatorId, tx)
  const first = performedBefore - (excludeId ? 1 : 0) <= 0
  return nextInspectionDue(input.performedAt, input.result, rulesFor(settings), first)
}

/** elevator.nextInspectionAt follows the latest performed inspection's nextDueAt. */
async function syncElevator(tenantId: string, elevatorId: string, tx: Tx) {
  const latest = await repo.latestPerformed(tenantId, elevatorId, tx)
  if (!latest) return
  await elevators.setNextInspection(tenantId, elevatorId, toDateOnly(latest.nextDueAt), tx)
}

export async function create(ctx: Ctx, body: CreateInspectionBody): Promise<InspectionDto> {
  const elevator = await elevators.find(ctx.tenantId, body.elevatorId)
  if (!elevator) throw notFound()
  if (body.performedAt && body.result === 'pending')
    throw new AppError(400, 'calendar.resultRequired')
  const created = await transaction(async (tx) => {
    const nextDueAt = await resolveNextDue(
      ctx.tenantId,
      elevator.id,
      { performedAt: body.performedAt ?? null, result: body.result, nextDueAt: body.nextDueAt },
      null,
      tx,
    )
    const i = await repo.createInspection(
      ctx.tenantId,
      {
        elevatorId: elevator.id,
        kind: body.kind,
        requestedAt: fromDateOnly(body.requestedAt),
        scheduledAt: fromDateOnly(body.scheduledAt),
        performedAt: fromDateOnly(body.performedAt),
        result: body.result,
        inspectionBody: body.inspectionBody ?? elevator.inspectionBody ?? null,
        nextDueAt: fromDateOnly(nextDueAt),
        notes: body.notes ?? null,
        defects: body.defects,
        createdByUserId: ctx.userId,
      },
      tx,
    )
    await syncElevator(ctx.tenantId, elevator.id, tx)
    await audit(
      actorOf(ctx),
      {
        action: 'inspection.create',
        entityType: 'inspection',
        entityId: i.id,
        after: { elevatorId: i.elevatorId, kind: i.kind, result: i.result, nextDueAt: i.nextDueAt },
      },
      tx,
    )
    return i
  })
  if (created.performedAt)
    await events.publish(ctx, {
      type: 'InspectionRecorded',
      aggregateType: 'inspection',
      aggregateId: created.id,
      payload: {
        elevatorId: created.elevatorId,
        result: created.result,
        nextDueAt: toDateOnly(created.nextDueAt),
      },
    })
  return toInspectionDto(created)
}

export async function update(
  ctx: Ctx,
  id: string,
  body: UpdateInspectionBody,
): Promise<InspectionDto> {
  const updated = await transaction(async (tx) => {
    const before = await repo.findInspection(ctx.tenantId, id, tx)
    if (!before) throw notFound()
    const performedAt =
      body.performedAt !== undefined ? body.performedAt : toDateOnly(before.performedAt)
    const result = body.result ?? before.result
    if (performedAt && result === 'pending') throw new AppError(400, 'calendar.resultRequired')
    const nextDueAt =
      body.nextDueAt !== undefined || body.performedAt !== undefined || body.result !== undefined
        ? await resolveNextDue(
            ctx.tenantId,
            before.elevatorId,
            { performedAt, result, nextDueAt: body.nextDueAt },
            before.id,
            tx,
          )
        : toDateOnly(before.nextDueAt)
    const i = await repo.updateInspection(
      ctx.tenantId,
      id,
      {
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.requestedAt !== undefined ? { requestedAt: fromDateOnly(body.requestedAt) } : {}),
        ...(body.scheduledAt !== undefined ? { scheduledAt: fromDateOnly(body.scheduledAt) } : {}),
        performedAt: fromDateOnly(performedAt),
        result,
        ...(body.inspectionBody !== undefined ? { inspectionBody: body.inspectionBody } : {}),
        nextDueAt: fromDateOnly(nextDueAt),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.defects !== undefined ? { defects: body.defects } : {}),
      },
      tx,
    )
    await syncElevator(ctx.tenantId, before.elevatorId, tx)
    await audit(
      actorOf(ctx),
      {
        action: 'inspection.update',
        entityType: 'inspection',
        entityId: id,
        before: {
          result: before.result,
          performedAt: before.performedAt,
          nextDueAt: before.nextDueAt,
        },
        after: { result: i.result, performedAt: i.performedAt, nextDueAt: i.nextDueAt },
      },
      tx,
    )
    return { before, i }
  })
  if (updated.i.performedAt && !updated.before.performedAt)
    await events.publish(ctx, {
      type: 'InspectionRecorded',
      aggregateType: 'inspection',
      aggregateId: id,
      payload: {
        elevatorId: updated.i.elevatorId,
        result: updated.i.result,
        nextDueAt: toDateOnly(updated.i.nextDueAt),
      },
    })
  return toInspectionDto(updated.i)
}

export async function get(ctx: Ctx, id: string): Promise<InspectionDto> {
  const i = await repo.findInspection(ctx.tenantId, id)
  if (!i) throw notFound()
  return toInspectionDto(i)
}

export async function list(ctx: Ctx, q: InspectionListQuery): Promise<Page<InspectionDto>> {
  const rows = await repo.listInspections(ctx.tenantId, {
    cursor: q.cursor,
    limit: q.limit,
    elevatorId: q.elevatorId,
    buildingId: q.buildingId,
    result: q.result,
    from: fromDateOnly(q.from) ?? undefined,
    to: q.to ? fromDateOnly(addDays(q.to, 1))! : undefined,
  })
  return page(rows, q.limit)
}

export async function listForElevator(
  ctx: Ctx,
  elevatorId: string,
  q: { cursor?: string; limit: number },
): Promise<Page<InspectionDto>> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  return page(await repo.listInspections(ctx.tenantId, { ...q, elevatorId }), q.limit)
}

function page(rows: InspectionRow[], limit: number): Page<InspectionDto> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return {
    items: items.map(toInspectionDto),
    nextCursor: hasMore ? items[items.length - 1]!.id : null,
  }
}

/** Scheduled (not yet performed) inspections - concrete dates for the calendar. */
export function scheduledRows(tenantId: string) {
  return repo.listScheduled(tenantId)
}

// ---- alarm-device tests ----------------------------------------------------------------------

function toAlarmTestDto(
  t: {
    id: string
    elevatorId: string
    testedAt: Date
    ok: boolean
    notes: string | null
    byUserId: string | null
    createdAt: Date
  },
  names: Map<string, string>,
): AlarmTestDto {
  return {
    id: t.id,
    elevatorId: t.elevatorId,
    testedAt: t.testedAt.toISOString(),
    ok: t.ok,
    notes: t.notes,
    byUserId: t.byUserId,
    byUserName: t.byUserId ? (names.get(t.byUserId) ?? null) : null,
    createdAt: t.createdAt.toISOString(),
  }
}

export async function logAlarmTest(
  ctx: Ctx,
  elevatorId: string,
  body: CreateAlarmTestBody,
): Promise<AlarmTestDto> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  const now = clock.now()
  const testedAt = body.testedAt ? new Date(body.testedAt) : now
  if (testedAt.getTime() > now.getTime() + MAX_FUTURE_MS)
    throw new AppError(400, 'calendar.testInFuture')
  const t = await repo.createAlarmTest(ctx.tenantId, {
    elevatorId,
    testedAt,
    ok: body.ok,
    notes: body.notes ?? null,
    byUserId: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'alarmTest.log',
    entityType: 'alarm_device_test',
    entityId: t.id,
    after: { elevatorId, ok: t.ok, testedAt: t.testedAt },
  })
  await events.publish(ctx, {
    type: 'AlarmDeviceTested',
    aggregateType: 'elevator',
    aggregateId: elevatorId,
    payload: { ok: t.ok, testedAt: t.testedAt.toISOString() },
  })
  const names = await namesFor(ctx.tenantId, [t.byUserId])
  return toAlarmTestDto(t, names)
}

export async function listAlarmTests(ctx: Ctx, elevatorId: string): Promise<AlarmTestDto[]> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  const rows = await repo.listAlarmTests(ctx.tenantId, elevatorId)
  const names = await namesFor(
    ctx.tenantId,
    rows.map((r) => r.byUserId),
  )
  return rows.map((r) => toAlarmTestDto(r, names))
}

async function namesFor(tenantId: string, ids: Array<string | null>) {
  const users = await findUsersByIds(tenantId, [...new Set(ids.filter((x): x is string => !!x))])
  return new Map(users.map((u) => [u.id, u.name]))
}

/** Latest alarm test per elevator (calendar: alarm tests due). */
export function latestAlarmTests(tenantId: string) {
  return repo.latestAlarmTests(tenantId)
}
