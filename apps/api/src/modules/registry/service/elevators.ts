import type { CreateElevatorBody, ElevatorDto, Page, UpdateElevatorBody } from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { toPage } from '../../../platform/http/pagination.js'
import { audit } from '../../../platform/audit.js'
import { clock, fromDateOnly } from '../../../platform/clock.js'
import { events } from '../../../platform/events/bus.js'
import { getTenantSettings } from '../../tenancy/index.js'
import * as repo from '../repo/elevators.js'
import * as buildings from '../repo/buildings.js'
import { toElevatorDto } from '../domain/mappers.js'
import { normalizeRegNo, normalizePhone } from '../domain/address.js'
import type { ElevatorStatus } from '../../../generated/prisma/index.js'

export async function list(
  ctx: Ctx,
  q: { cursor?: string; limit: number; q?: string; buildingId?: string; status?: ElevatorStatus },
): Promise<Page<ElevatorDto>> {
  const settings = await getTenantSettings(ctx.tenantId)
  return toPage(await repo.listElevators(ctx.tenantId, q), q.limit, (e) =>
    toElevatorDto(e, settings),
  )
}

export async function get(ctx: Ctx, id: string): Promise<ElevatorDto> {
  const e = await repo.findElevator(ctx.tenantId, id)
  if (!e) throw notFound()
  return toElevatorDto(e, await getTenantSettings(ctx.tenantId))
}

export async function create(ctx: Ctx, body: CreateElevatorBody): Promise<ElevatorDto> {
  if (!(await buildings.findBuilding(ctx.tenantId, body.buildingId))) throw notFound()
  const regNoNormalized = normalizeRegNo(body.regNo)
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
    lastCheckAt: fromDateOnly(body.lastCheckAt),
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
  return toElevatorDto(e, await getTenantSettings(ctx.tenantId))
}

export async function update(ctx: Ctx, id: string, body: UpdateElevatorBody): Promise<ElevatorDto> {
  const before = await repo.findElevator(ctx.tenantId, id)
  if (!before) throw notFound()
  if (body.buildingId && !(await buildings.findBuilding(ctx.tenantId, body.buildingId)))
    throw notFound()
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
    ...(body.checkIntervalDays !== undefined ? { checkIntervalDays: body.checkIntervalDays } : {}),
    ...(body.lastCheckAt !== undefined ? { lastCheckAt: fromDateOnly(body.lastCheckAt) } : {}),
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
  return toElevatorDto(e, await getTenantSettings(ctx.tenantId))
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
