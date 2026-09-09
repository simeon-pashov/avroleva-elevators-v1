import type {
  Address,
  CreateZoneBody,
  UpdateZoneBody,
  ZoneDto,
  ZoneRecomputeResultDto,
} from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf, systemActorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { audit } from '../../../platform/audit.js'
import { clock } from '../../../platform/clock.js'
import * as repo from '../repo/zones.js'
import type { ZoneRow } from '../repo/zones.js'
import * as buildingsRepo from '../repo/buildings.js'
import { parseZonePolygon, toZoneDto } from '../domain/mappers.js'
import { assignZone } from '../domain/zone.js'
import type { ZoneAssignable, ZoneLike } from '../domain/zone.js'

/**
 * Zones (Райони, step 9): tenant data, never a rule. The default zone "Всички" is created lazily
 * on the first read / assignment and catches every building no polygon or district claims. Every
 * write here re-runs the assignment of the non-manual buildings, so the map and the day plan
 * always see the current shape.
 */
export const DEFAULT_ZONE_NAME = 'Всички'
const DEFAULT_ZONE_COLOUR = '#64748b'

const actor = (ctx: Ctx) => (ctx.userId ? actorOf(ctx) : systemActorOf(ctx.tenantId))

export async function ensureDefaultZone(tenantId: string): Promise<ZoneRow> {
  const existing = await repo.findDefaultZone(tenantId)
  if (existing) return existing
  return repo.createZone(tenantId, {
    name: DEFAULT_ZONE_NAME,
    colour: DEFAULT_ZONE_COLOUR,
    isDefault: true,
    position: 1000,
    districts: [],
  })
}

function toZoneLike(z: ZoneRow): ZoneLike {
  return {
    id: z.id,
    polygon: parseZonePolygon(z.polygon),
    districts: z.districts,
    position: z.position,
    isDefault: z.isDefault,
    active: z.active,
  }
}

/** Every live zone (the default one created when missing). */
async function liveZones(tenantId: string): Promise<ZoneRow[]> {
  await ensureDefaultZone(tenantId)
  return repo.listZones(tenantId)
}

/** The zone a building belongs to by the current rules (polygon, district, default). */
export async function resolveZoneFor(
  tenantId: string,
  building: ZoneAssignable,
): Promise<string | null> {
  const zones = await liveZones(tenantId)
  return assignZone(building, zones.map(toZoneLike))
}

/** Existence check for other modules (maintenance pairs): a live, active zone or null. */
export async function find(tenantId: string, id: string): Promise<ZoneRow | null> {
  const z = await repo.findZone(tenantId, id)
  return z && z.active ? z : null
}

/** 404 when the zone is missing / archived - used by the building override. */
export async function requireZone(tenantId: string, id: string): Promise<ZoneRow> {
  const z = await repo.findZone(tenantId, id)
  if (!z) throw notFound('zones.notFound')
  return z
}

export async function list(ctx: Ctx): Promise<ZoneDto[]> {
  const [zones, counts] = await Promise.all([
    liveZones(ctx.tenantId),
    repo.buildingCountsByZone(ctx.tenantId),
  ])
  return zones.map((z) => toZoneDto(z, counts.get(z.id) ?? 0))
}

export async function get(ctx: Ctx, id: string): Promise<ZoneDto> {
  const z = await repo.findZone(ctx.tenantId, id)
  if (!z) throw notFound()
  const counts = await repo.buildingCountsByZone(ctx.tenantId)
  return toZoneDto(z, counts.get(z.id) ?? 0)
}

export async function create(ctx: Ctx, body: CreateZoneBody): Promise<ZoneDto> {
  await ensureDefaultZone(ctx.tenantId)
  const position = body.position ?? (await nextPosition(ctx.tenantId))
  const z = await repo.createZone(ctx.tenantId, {
    name: body.name,
    colour: body.colour,
    polygon: body.polygon ?? undefined,
    districts: body.districts,
    position,
    createdBy: ctx.userId || null,
  })
  await audit(actor(ctx), {
    action: 'zone.create',
    entityType: 'zone',
    entityId: z.id,
    after: { name: z.name, districts: z.districts, hasPolygon: !!z.polygon, position },
  })
  const r = await recomputeBuildings(ctx.tenantId)
  return toZoneDto(z, await countOf(ctx.tenantId, z.id, r))
}

export async function update(ctx: Ctx, id: string, body: UpdateZoneBody): Promise<ZoneDto> {
  const before = await repo.findZone(ctx.tenantId, id)
  if (!before) throw notFound()
  // The default zone stays the catch-all: it cannot be switched off.
  if (before.isDefault && body.active === false) throw new AppError(409, 'zones.isDefault')
  const z = await repo.updateZone(ctx.tenantId, id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.colour !== undefined ? { colour: body.colour } : {}),
    ...(body.polygon !== undefined
      ? { polygon: before.isDefault ? undefined : (body.polygon ?? undefined) }
      : {}),
    ...(body.districts !== undefined ? { districts: before.isDefault ? [] : body.districts } : {}),
    ...(body.position !== undefined ? { position: body.position } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
    updatedBy: ctx.userId || null,
  })
  // Prisma leaves a Json column alone on `undefined`; an explicit null clears the polygon.
  const cleared =
    body.polygon === null && !before.isDefault
      ? await repo.updateZone(ctx.tenantId, id, { polygon: null as never })
      : z
  await audit(actor(ctx), {
    action: 'zone.update',
    entityType: 'zone',
    entityId: id,
    before: { name: before.name, districts: before.districts, active: before.active },
    after: { name: cleared.name, districts: cleared.districts, active: cleared.active },
  })
  const r = await recomputeBuildings(ctx.tenantId)
  return toZoneDto(cleared, await countOf(ctx.tenantId, id, r))
}

/** Soft delete; the zone's buildings go back to automatic assignment and are re-assigned. */
export async function archive(ctx: Ctx, id: string): Promise<void> {
  const before = await repo.findZone(ctx.tenantId, id)
  if (!before) throw notFound()
  if (before.isDefault) throw new AppError(409, 'zones.isDefault')
  await repo.updateZone(ctx.tenantId, id, {
    deletedAt: clock.now(),
    active: false,
    updatedBy: ctx.userId || null,
  })
  const moved = await recomputeBuildings(ctx.tenantId, { zoneId: id, clearManual: true })
  await audit(actor(ctx), {
    action: 'zone.archive',
    entityType: 'zone',
    entityId: id,
    before: { name: before.name },
    after: { buildingsReassigned: moved.changed },
  })
}

/** POST /zones/recompute - every non-manual building, audited. */
export async function recompute(ctx: Ctx): Promise<ZoneRecomputeResultDto> {
  const r = await recomputeBuildings(ctx.tenantId)
  await audit(actor(ctx), {
    action: 'zone.recompute',
    entityType: 'zone',
    entityId: null,
    after: r,
  })
  return r
}

/** Cron `registry.recomputeZones` and the demo generator: no audit line, idempotent. */
export function recomputeAll(tenantId: string): Promise<ZoneRecomputeResultDto> {
  return recomputeBuildings(tenantId)
}

/**
 * Re-assigns buildings by the current zones. Default: every non-manual live building. `ids`
 * limits the set (after an import), `zoneId` targets one zone's buildings and `clearManual`
 * drops their override (the zone they pointed at is gone).
 */
export async function recomputeBuildings(
  tenantId: string,
  filter: { ids?: string[]; zoneId?: string; clearManual?: boolean } = {},
): Promise<ZoneRecomputeResultDto> {
  const zones = (await liveZones(tenantId)).map(toZoneLike)
  const rows = await buildingsRepo.listForZoneAssign(tenantId, {
    ids: filter.ids,
    zoneId: filter.zoneId,
    onlyAuto: !filter.clearManual,
  })
  let changed = 0
  for (const b of rows) {
    const zoneId = assignZone(
      { lat: b.lat, lng: b.lng, address: b.address as Address | null },
      zones,
    )
    if (zoneId !== b.zoneId || (filter.clearManual && b.zoneManual)) {
      await buildingsRepo.setBuildingZone(tenantId, b.id, zoneId, false)
      changed++
    }
  }
  return { changed, total: rows.length }
}

async function nextPosition(tenantId: string): Promise<number> {
  const zones = await repo.listZones(tenantId)
  const max = zones.filter((z) => !z.isDefault).reduce((m, z) => Math.max(m, z.position), -1)
  return Math.min(999, max + 1)
}

async function countOf(tenantId: string, zoneId: string, _r: ZoneRecomputeResultDto) {
  return (await repo.buildingCountsByZone(tenantId)).get(zoneId) ?? 0
}
