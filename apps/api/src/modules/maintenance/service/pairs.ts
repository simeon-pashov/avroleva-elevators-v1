import type {
  CreateTechnicianPairBody,
  TechnicianPairDto,
  UpdateTechnicianPairBody,
} from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf, systemActorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { audit } from '../../../platform/audit.js'
import { clock } from '../../../platform/clock.js'
import { findUsersByIds } from '../../tenancy/index.js'
import { zones } from '../../registry/index.js'
import * as repo from '../repo/pairs.js'
import type { PairRow } from '../repo/pairs.js'

/**
 * Technician pairs (екипи, step 9): one to three people who go out together, optionally with a
 * vehicle and a home zone. Tenant data; the day plan distributes the stops across them.
 */
const actor = (ctx: Ctx) => (ctx.userId ? actorOf(ctx) : systemActorOf(ctx.tenantId))

export function toPairDto(p: PairRow, names: Map<string, string>): TechnicianPairDto {
  return {
    id: p.id,
    name: p.name,
    userIds: p.userIds,
    userNames: p.userIds.map((id) => names.get(id) ?? ''),
    vehicle: p.vehicle,
    defaultZoneId: p.defaultZoneId,
    position: p.position,
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export async function namesFor(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const users = await findUsersByIds(tenantId, unique)
  return new Map(users.map((u) => [u.id, u.name]))
}

async function validateUsers(tenantId: string, userIds: string[]): Promise<void> {
  if (new Set(userIds).size !== userIds.length) throw new AppError(400, 'pairs.duplicateUsers')
  const users = await findUsersByIds(tenantId, userIds)
  if (users.length !== userIds.length || users.some((u) => !u.isActive))
    throw new AppError(400, 'pairs.userNotFound')
}

async function validateZone(tenantId: string, zoneId: string | null | undefined): Promise<void> {
  if (!zoneId) return
  if (!(await zones.find(tenantId, zoneId))) throw new AppError(400, 'pairs.zoneNotFound')
}

export async function list(ctx: Ctx): Promise<TechnicianPairDto[]> {
  const rows = await repo.listPairs(ctx.tenantId)
  const names = await namesFor(
    ctx.tenantId,
    rows.flatMap((p) => p.userIds),
  )
  return rows.map((p) => toPairDto(p, names))
}

/** Rows for the day plan: active pairs by position. */
export function listActive(tenantId: string): Promise<PairRow[]> {
  return repo.listPairs(tenantId, { activeOnly: true })
}

export function find(tenantId: string, id: string): Promise<PairRow | null> {
  return repo.findPair(tenantId, id)
}

export function findByIds(tenantId: string, ids: string[]): Promise<PairRow[]> {
  return repo.findPairsByIds(tenantId, ids)
}

export async function create(ctx: Ctx, body: CreateTechnicianPairBody): Promise<TechnicianPairDto> {
  await validateUsers(ctx.tenantId, body.userIds)
  await validateZone(ctx.tenantId, body.defaultZoneId)
  const position = body.position ?? (await repo.maxPosition(ctx.tenantId)) + 1
  const p = await repo.createPair(ctx.tenantId, {
    name: body.name,
    userIds: body.userIds,
    vehicle: body.vehicle ?? null,
    defaultZoneId: body.defaultZoneId ?? null,
    position: Math.min(1000, position),
    createdBy: ctx.userId || null,
  })
  await audit(actor(ctx), {
    action: 'pair.create',
    entityType: 'technician_pair',
    entityId: p.id,
    after: { name: p.name, userIds: p.userIds, defaultZoneId: p.defaultZoneId },
  })
  return toPairDto(p, await namesFor(ctx.tenantId, p.userIds))
}

export async function update(
  ctx: Ctx,
  id: string,
  body: UpdateTechnicianPairBody,
): Promise<TechnicianPairDto> {
  const before = await repo.findPair(ctx.tenantId, id)
  if (!before) throw notFound()
  if (body.userIds !== undefined) await validateUsers(ctx.tenantId, body.userIds)
  if (body.defaultZoneId !== undefined) await validateZone(ctx.tenantId, body.defaultZoneId)
  const p = await repo.updatePair(ctx.tenantId, id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.userIds !== undefined ? { userIds: body.userIds } : {}),
    ...(body.vehicle !== undefined ? { vehicle: body.vehicle } : {}),
    ...(body.defaultZoneId !== undefined ? { defaultZoneId: body.defaultZoneId } : {}),
    ...(body.position !== undefined ? { position: body.position } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
    updatedBy: ctx.userId || null,
  })
  await audit(actor(ctx), {
    action: 'pair.update',
    entityType: 'technician_pair',
    entityId: id,
    before: { name: before.name, userIds: before.userIds, active: before.active },
    after: { name: p.name, userIds: p.userIds, active: p.active },
  })
  return toPairDto(p, await namesFor(ctx.tenantId, p.userIds))
}

/** Soft delete; existing plans keep their pairId (history stays readable). */
export async function archive(ctx: Ctx, id: string): Promise<void> {
  const before = await repo.findPair(ctx.tenantId, id)
  if (!before) throw notFound()
  await repo.updatePair(ctx.tenantId, id, {
    deletedAt: clock.now(),
    active: false,
    updatedBy: ctx.userId || null,
  })
  await audit(actor(ctx), {
    action: 'pair.archive',
    entityType: 'technician_pair',
    entityId: id,
    before: { name: before.name, userIds: before.userIds },
  })
}
