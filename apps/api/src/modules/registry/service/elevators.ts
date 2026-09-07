import type {
  CreateElevatorBody,
  ElevatorDetailDto,
  ElevatorDto,
  Page,
  UpdateElevatorBody,
} from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { toPage } from '../../../platform/http/pagination.js'
import { audit } from '../../../platform/audit.js'
import { clock, fromDateOnly, toDateOnly } from '../../../platform/clock.js'
import { events } from '../../../platform/events/bus.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { getTenantSettings } from '../../tenancy/index.js'
import * as repo from '../repo/elevators.js'
import * as buildings from '../repo/buildings.js'
import { toElevatorDetailDto, toElevatorDto } from '../domain/mappers.js'
import { normalizeRegNo, normalizePhone } from '../domain/address.js'
import { computeNextDue } from '../domain/due.js'
import type { ElevatorStatus } from '../../../generated/prisma/index.js'

export type { ElevatorDetailRow } from '../repo/elevators.js'

export async function list(
  ctx: Ctx,
  q: { cursor?: string; limit: number; q?: string; buildingId?: string; status?: ElevatorStatus },
): Promise<Page<ElevatorDto>> {
  const settings = await getTenantSettings(ctx.tenantId)
  return toPage(await repo.listElevators(ctx.tenantId, q), q.limit, (e) =>
    toElevatorDto(e, settings),
  )
}

/** Detail for the popup/side panel: identity + contact + customer + price. */
export async function get(ctx: Ctx, id: string): Promise<ElevatorDetailDto> {
  const e = await repo.findElevatorDetail(ctx.tenantId, id)
  if (!e) throw notFound()
  return toElevatorDetailDto(e, await getTenantSettings(ctx.tenantId))
}

/** Existence check for other modules (visits, billing): the row or null, never a DTO. */
export function find(tenantId: string, id: string, tx?: Tx) {
  return repo.findElevator(tenantId, id, tx)
}

/** Read model for the due board and the map pins (maintenance, reporting). */
export function listForSchedule(tenantId: string) {
  return repo.listForSchedule(tenantId)
}

export async function create(ctx: Ctx, body: CreateElevatorBody): Promise<ElevatorDto> {
  if (!(await buildings.findBuilding(ctx.tenantId, body.buildingId))) throw notFound()
  const settings = await getTenantSettings(ctx.tenantId)
  const regNoNormalized = normalizeRegNo(body.regNo)
  const lastCheckAt = fromDateOnly(body.lastCheckAt)
  const e = await repo.createElevator(ctx.tenantId, {
    buildingId: body.buildingId,
    internalNo: body.internalNo,
    regNo: body.regNo ?? null,
    regNoNormalized,
    inspectionBody: body.inspectionBody ?? null,
    manufacturer: body.manufacturer ?? null,
    year: body.year ?? null,
    driveType: body.driveType,
    doorType: body.doorType,
    stops: body.stops,
    loadKg: body.loadKg ?? null,
    status: body.status,
    checkIntervalDays: body.checkIntervalDays ?? null,
    lastCheckAt,
    nextCheckDueAt: fromDateOnly(
      computeNextDue(
        {
          checkIntervalDays: body.checkIntervalDays ?? null,
          lastCheckAt,
          nextCheckOverrideAt: null,
        },
        settings,
      ),
    ),
    nextInspectionAt: fromDateOnly(body.nextInspectionAt),
    alarmDevicePhone: normalizePhone(body.alarmDevicePhone),
    alarmSimOperator: body.alarmSimOperator ?? null,
    notes: body.notes ?? null,
    createdBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'elevator.create',
    entityType: 'elevator',
    entityId: e.id,
    after: { internalNo: e.internalNo, buildingId: e.buildingId },
  })
  await events.publish(ctx, {
    type: 'ElevatorRegistered',
    aggregateType: 'elevator',
    aggregateId: e.id,
    payload: { buildingId: e.buildingId, status: e.status },
  })
  return toElevatorDto(e, settings)
}

export async function update(ctx: Ctx, id: string, body: UpdateElevatorBody): Promise<ElevatorDto> {
  const before = await repo.findElevator(ctx.tenantId, id)
  if (!before) throw notFound()
  if (body.buildingId && !(await buildings.findBuilding(ctx.tenantId, body.buildingId)))
    throw notFound()
  const settings = await getTenantSettings(ctx.tenantId)
  const checkIntervalDays =
    body.checkIntervalDays !== undefined ? body.checkIntervalDays : before.checkIntervalDays
  const lastCheckAt =
    body.lastCheckAt !== undefined ? fromDateOnly(body.lastCheckAt) : before.lastCheckAt
  // Editing the last check date by hand is a correction; a pending reschedule no longer applies.
  const nextCheckOverrideAt =
    body.lastCheckAt !== undefined && body.lastCheckAt !== toDateOnly(before.lastCheckAt)
      ? null
      : before.nextCheckOverrideAt
  const e = await repo.updateElevator(ctx.tenantId, id, {
    ...(body.buildingId !== undefined ? { buildingId: body.buildingId } : {}),
    ...(body.internalNo !== undefined ? { internalNo: body.internalNo } : {}),
    ...(body.regNo !== undefined
      ? { regNo: body.regNo, regNoNormalized: normalizeRegNo(body.regNo) }
      : {}),
    ...(body.inspectionBody !== undefined ? { inspectionBody: body.inspectionBody } : {}),
    ...(body.manufacturer !== undefined ? { manufacturer: body.manufacturer } : {}),
    ...(body.year !== undefined ? { year: body.year } : {}),
    ...(body.driveType !== undefined ? { driveType: body.driveType } : {}),
    ...(body.doorType !== undefined ? { doorType: body.doorType } : {}),
    ...(body.stops !== undefined ? { stops: body.stops } : {}),
    ...(body.loadKg !== undefined ? { loadKg: body.loadKg } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    checkIntervalDays,
    lastCheckAt,
    nextCheckOverrideAt,
    nextCheckDueAt: fromDateOnly(
      computeNextDue({ checkIntervalDays, lastCheckAt, nextCheckOverrideAt }, settings),
    ),
    ...(body.nextInspectionAt !== undefined
      ? { nextInspectionAt: fromDateOnly(body.nextInspectionAt) }
      : {}),
    ...(body.alarmDevicePhone !== undefined
      ? { alarmDevicePhone: normalizePhone(body.alarmDevicePhone) }
      : {}),
    ...(body.alarmSimOperator !== undefined ? { alarmSimOperator: body.alarmSimOperator } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    updatedBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'elevator.update',
    entityType: 'elevator',
    entityId: id,
    before: {
      status: before.status,
      lastCheckAt: before.lastCheckAt,
      checkIntervalDays: before.checkIntervalDays,
    },
    after: { status: e.status, lastCheckAt: e.lastCheckAt, checkIntervalDays: e.checkIntervalDays },
  })
  if (body.status !== undefined && body.status !== before.status) {
    await events.publish(ctx, {
      type: 'ElevatorStatusChanged',
      aggregateType: 'elevator',
      aggregateId: id,
      payload: { from: before.status, to: e.status },
    })
  } else {
    await events.publish(ctx, {
      type: 'ElevatorUpdated',
      aggregateType: 'elevator',
      aggregateId: id,
      payload: {},
    })
  }
  return toElevatorDto(e, settings)
}

/**
 * Command for the visits module: a functional check / technical maintenance was done on `date`.
 * lastCheckAt never moves backwards (paper backfill of an older visit keeps the newer date); the
 * one-off reschedule is cleared either way and nextCheckDueAt is recomputed.
 */
export async function recordCheck(
  tenantId: string,
  elevatorId: string,
  date: string,
  tx?: Tx,
): Promise<void> {
  const e = await repo.findElevator(tenantId, elevatorId, tx)
  if (!e) throw notFound()
  const settings = await getTenantSettings(tenantId)
  const current = toDateOnly(e.lastCheckAt)
  const lastCheckAt = fromDateOnly(current && current > date ? current : date)
  await repo.updateElevator(
    tenantId,
    elevatorId,
    {
      lastCheckAt,
      nextCheckOverrideAt: null,
      nextCheckDueAt: fromDateOnly(
        computeNextDue(
          { checkIntervalDays: e.checkIntervalDays, lastCheckAt, nextCheckOverrideAt: null },
          settings,
        ),
      ),
    },
    tx,
  )
}

/** Command for the maintenance module: "Премести за утре" (or clear with null). */
export async function setCheckOverride(
  ctx: Ctx,
  elevatorId: string,
  toDate: string | null,
): Promise<ElevatorDto> {
  const before = await repo.findElevator(ctx.tenantId, elevatorId)
  if (!before) throw notFound()
  const settings = await getTenantSettings(ctx.tenantId)
  const nextCheckOverrideAt = fromDateOnly(toDate)
  const e = await repo.updateElevator(ctx.tenantId, elevatorId, {
    nextCheckOverrideAt,
    nextCheckDueAt: fromDateOnly(
      computeNextDue(
        {
          checkIntervalDays: before.checkIntervalDays,
          lastCheckAt: before.lastCheckAt,
          nextCheckOverrideAt,
        },
        settings,
      ),
    ),
    updatedBy: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'elevator.reschedule',
    entityType: 'elevator',
    entityId: elevatorId,
    before: { nextCheckDueAt: before.nextCheckDueAt, override: before.nextCheckOverrideAt },
    after: { nextCheckDueAt: e.nextCheckDueAt, override: e.nextCheckOverrideAt },
  })
  return toElevatorDto(e, settings)
}

/** Recomputes nextCheckDueAt for every elevator (tenant interval / strategy changed). */
export async function recomputeSchedule(tenantId: string): Promise<number> {
  const settings = await getTenantSettings(tenantId)
  const rows = await repo.listForRecompute(tenantId)
  let changed = 0
  for (const r of rows) {
    const next = fromDateOnly(computeNextDue(r, settings))
    if ((next?.getTime() ?? null) !== (r.nextCheckDueAt?.getTime() ?? null)) {
      await repo.updateElevator(tenantId, r.id, { nextCheckDueAt: next })
      changed++
    }
  }
  return changed
}

/**
 * Command for the defects module (stop-lift defect recorded / resolved) and the office: sets the
 * status with a reason, stamps stoppedAt, writes the audit entry and publishes
 * ElevatorStatusChanged. Same transaction as the caller when `tx` is given.
 */
export async function setStatus(
  ctx: Ctx,
  elevatorId: string,
  status: ElevatorStatus,
  reason: string | null,
  tx?: Tx,
): Promise<void> {
  const before = await repo.findElevator(ctx.tenantId, elevatorId, tx)
  if (!before) throw notFound()
  if (before.status === status) return
  const stopped = status === 'stopped_by_firm' || status === 'stopped_by_authority'
  await repo.updateElevator(
    ctx.tenantId,
    elevatorId,
    {
      status,
      stoppedAt: stopped ? clock.now() : null,
      stopReason: stopped ? reason : null,
      updatedBy: ctx.userId,
    },
    tx,
  )
  await audit(
    actorOf(ctx),
    {
      action: 'elevator.setStatus',
      entityType: 'elevator',
      entityId: elevatorId,
      before: { status: before.status },
      after: { status, reason },
    },
    tx,
  )
  await events.publish(
    ctx,
    {
      type: 'ElevatorStatusChanged',
      aggregateType: 'elevator',
      aggregateId: elevatorId,
      payload: { from: before.status, to: status, reason },
    },
    tx,
  )
}

/** Command for the calendar module: the next inspection date follows the latest inspection. */
export async function setNextInspection(
  tenantId: string,
  elevatorId: string,
  date: string | null,
  tx?: Tx,
): Promise<void> {
  const e = await repo.findElevator(tenantId, elevatorId, tx)
  if (!e) throw notFound()
  if (toDateOnly(e.nextInspectionAt) === date) return
  await repo.updateElevator(tenantId, elevatorId, { nextInspectionAt: fromDateOnly(date) }, tx)
}

/** Public facade: the elevator (with tenantId) behind a QR token, or null. */
export function findByPublicToken(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return Promise.resolve(null)
  return repo.findByPublicToken(token)
}

/** "Смени кода": the old QR label stops working immediately. */
export async function rotateToken(ctx: Ctx, elevatorId: string): Promise<ElevatorDetailDto> {
  const before = await repo.findElevator(ctx.tenantId, elevatorId)
  if (!before) throw notFound()
  await repo.rotatePublicToken(ctx.tenantId, elevatorId)
  await audit(actorOf(ctx), {
    action: 'elevator.rotateToken',
    entityType: 'elevator',
    entityId: elevatorId,
  })
  return get(ctx, elevatorId)
}

/** Warn-only duplicate check on registration number (ARCHITECTURE section 3). */
export async function duplicateRegNo(
  ctx: Ctx,
  regNo: string,
  excludeId?: string,
): Promise<{ id: string; internalNo: string } | null> {
  const norm = normalizeRegNo(regNo)
  if (!norm) return null
  return repo.findByRegNoNormalized(ctx.tenantId, norm, excludeId)
}

export async function archive(ctx: Ctx, id: string): Promise<void> {
  const before = await repo.findElevator(ctx.tenantId, id)
  if (!before) throw notFound()
  if (before.status !== 'scrapped' && before.status !== 'out_of_contract')
    throw new AppError(409, 'elevators.archiveOnlyInactive')
  await repo.updateElevator(ctx.tenantId, id, { deletedAt: clock.now(), updatedBy: ctx.userId })
  await audit(actorOf(ctx), { action: 'elevator.archive', entityType: 'elevator', entityId: id })
}
