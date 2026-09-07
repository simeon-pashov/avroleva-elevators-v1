import type {
  ContractDto,
  CreateContractBody,
  Page,
  TerminateContractBody,
  UpdateContractBody,
} from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { toPage } from '../../../platform/http/pagination.js'
import { audit } from '../../../platform/audit.js'
import { clock, fromDateOnly } from '../../../platform/clock.js'
import { events } from '../../../platform/events/bus.js'
import { transaction } from '../../../platform/db/prisma.js'
import * as repo from '../repo/contracts.js'
import * as customers from '../repo/customers.js'
import * as buildings from '../repo/buildings.js'
import * as elevators from '../repo/elevators.js'
import { toContractDto } from '../domain/mappers.js'
import type { ContractStatus } from '../../../generated/prisma/index.js'

export async function list(
  ctx: Ctx,
  q: {
    cursor?: string
    limit: number
    q?: string
    customerId?: string
    buildingId?: string
    status?: ContractStatus
  },
): Promise<Page<ContractDto>> {
  return toPage(await repo.listContracts(ctx.tenantId, q), q.limit, toContractDto)
}

export async function get(ctx: Ctx, id: string): Promise<ContractDto> {
  const c = await repo.findContract(ctx.tenantId, id)
  if (!c) throw notFound()
  return toContractDto(c)
}

async function assertLines(ctx: Ctx, buildingId: string, lines: CreateContractBody['lines']) {
  const ids = [...new Set(lines.map((l) => l.elevatorId))]
  if (ids.length !== lines.length) throw new AppError(400, 'contracts.duplicateElevator')
  const found = await elevators.findElevatorsByIds(ctx.tenantId, ids)
  if (found.length !== ids.length) throw notFound()
  if (found.some((e) => e.buildingId !== buildingId))
    throw new AppError(400, 'contracts.elevatorNotInBuilding')
}

export async function create(ctx: Ctx, body: CreateContractBody): Promise<ContractDto> {
  if (!(await customers.findCustomer(ctx.tenantId, body.customerId))) throw notFound()
  if (!(await buildings.findBuilding(ctx.tenantId, body.buildingId))) throw notFound()
  await assertLines(ctx, body.buildingId, body.lines)
  const startDate = fromDateOnly(body.startDate)!
  const c = await transaction(async (tx) => {
    const created = await repo.createContract(
      ctx.tenantId,
      {
        customerId: body.customerId,
        buildingId: body.buildingId,
        startDate,
        endDate: fromDateOnly(body.endDate),
        status: body.status,
        paymentDay: body.paymentDay ?? null,
        notes: body.notes ?? null,
        createdBy: ctx.userId,
      },
      body.lines,
      tx,
    )
    if (created.status === 'active') {
      const outOfContract = (
        await elevators.findElevatorsByIds(
          ctx.tenantId,
          body.lines.map((l) => l.elevatorId),
          tx,
        )
      )
        .filter((e) => e.status === 'out_of_contract')
        .map((e) => e.id)
      if (outOfContract.length)
        await elevators.updateElevatorsStatus(ctx.tenantId, outOfContract, 'active', tx)
    }
    await audit(
      actorOf(ctx),
      {
        action: 'contract.create',
        entityType: 'contract',
        entityId: created.id,
        after: { buildingId: created.buildingId, lines: body.lines.length },
      },
      tx,
    )
    return created
  })
  if (c.status === 'active') {
    await events.publish(ctx, {
      type: 'ContractStarted',
      aggregateType: 'contract',
      aggregateId: c.id,
      payload: { buildingId: c.buildingId, elevatorIds: body.lines.map((l) => l.elevatorId) },
    })
  }
  return toContractDto(c)
}

export async function update(ctx: Ctx, id: string, body: UpdateContractBody): Promise<ContractDto> {
  const before = await repo.findContract(ctx.tenantId, id)
  if (!before) throw notFound()
  if (before.status === 'terminated') throw new AppError(409, 'contracts.terminated')
  if (body.customerId && !(await customers.findCustomer(ctx.tenantId, body.customerId)))
    throw notFound()
  const buildingId = body.buildingId ?? before.buildingId
  if (body.buildingId && !(await buildings.findBuilding(ctx.tenantId, body.buildingId)))
    throw notFound()
  if (body.lines) await assertLines(ctx, buildingId, body.lines)
  const c = await transaction(async (tx) => {
    const updated = await repo.updateContract(
      ctx.tenantId,
      id,
      {
        ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
        ...(body.buildingId !== undefined ? { buildingId: body.buildingId } : {}),
        ...(body.startDate !== undefined ? { startDate: fromDateOnly(body.startDate)! } : {}),
        ...(body.endDate !== undefined ? { endDate: fromDateOnly(body.endDate) } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.paymentDay !== undefined ? { paymentDay: body.paymentDay } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )
    if (body.lines) {
      await repo.replaceLines(ctx.tenantId, id, body.lines, updated.startDate, tx)
    }
    await audit(
      actorOf(ctx),
      {
        action: 'contract.update',
        entityType: 'contract',
        entityId: id,
        before: { status: before.status },
        after: { status: updated.status },
      },
      tx,
    )
    return repo.findContract(ctx.tenantId, id, tx)
  })
  return toContractDto(c!)
}

/** Ends the contract; its elevators without another active contract go `out_of_contract`. */
export async function terminate(
  ctx: Ctx,
  id: string,
  body: TerminateContractBody,
): Promise<ContractDto> {
  const before = await repo.findContract(ctx.tenantId, id)
  if (!before) throw notFound()
  if (before.status === 'terminated') throw new AppError(409, 'contracts.terminated')
  const endDate = fromDateOnly(body.endDate)!
  const elevatorIds = before.lines.map((l) => l.elevatorId)
  const c = await transaction(async (tx) => {
    const updated = await repo.updateContract(
      ctx.tenantId,
      id,
      {
        status: 'terminated',
        endDate,
        terminatedReason: body.reason ?? null,
        updatedBy: ctx.userId,
      },
      tx,
    )
    await repo.closeLines(ctx.tenantId, id, endDate, tx)
    const stillCovered = new Set(
      (await repo.findActiveContractForBuilding(ctx.tenantId, before.buildingId, tx))?.lines.map(
        (l) => l.elevatorId,
      ) ?? [],
    )
    const toRelease = elevatorIds.filter((eid) => !stillCovered.has(eid))
    if (toRelease.length)
      await elevators.updateElevatorsStatus(ctx.tenantId, toRelease, 'out_of_contract', tx)
    await audit(
      actorOf(ctx),
      {
        action: 'contract.terminate',
        entityType: 'contract',
        entityId: id,
        after: { endDate: body.endDate, released: toRelease },
      },
      tx,
    )
    return updated
  })
  await events.publish(ctx, {
    type: 'ContractTerminated',
    aggregateType: 'contract',
    aggregateId: id,
    payload: { buildingId: c.buildingId, elevatorIds },
  })
  return toContractDto(c)
}

export async function archive(ctx: Ctx, id: string): Promise<void> {
  const before = await repo.findContract(ctx.tenantId, id)
  if (!before) throw notFound()
  if (before.status === 'active') throw new AppError(409, 'contracts.archiveOnlyInactive')
  await repo.updateContract(ctx.tenantId, id, { deletedAt: clock.now(), updatedBy: ctx.userId })
  await audit(actorOf(ctx), { action: 'contract.archive', entityType: 'contract', entityId: id })
}
