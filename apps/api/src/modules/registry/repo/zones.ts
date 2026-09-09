import { prisma } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { Prisma, Zone } from '../../../generated/prisma/index.js'

export type ZoneRow = Zone

/** Live zones of a tenant (not archived), by position then creation order. */
export function listZones(
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ZoneRow[]> {
  return prisma.zone.findMany({
    where: { tenantId, deletedAt: null, ...(opts.activeOnly ? { active: true } : {}) },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })
}

export function findZone(tenantId: string, id: string): Promise<ZoneRow | null> {
  return prisma.zone.findFirst({ where: { id, tenantId, deletedAt: null } })
}

export function findDefaultZone(tenantId: string): Promise<ZoneRow | null> {
  return prisma.zone.findFirst({
    where: { tenantId, deletedAt: null, isDefault: true },
    orderBy: { createdAt: 'asc' },
  })
}

export type ZoneData = Omit<Prisma.ZoneUncheckedCreateInput, 'id' | 'tenantId'>

export function createZone(tenantId: string, data: ZoneData): Promise<ZoneRow> {
  return prisma.zone.create({ data: { id: newId(), tenantId, ...data } })
}

export function updateZone(
  tenantId: string,
  id: string,
  data: Prisma.ZoneUncheckedUpdateInput,
): Promise<ZoneRow> {
  return prisma.zone.update({ where: { id, tenantId }, data })
}

/** Buildings per zone (live buildings only); key null = buildings without a zone. */
export async function buildingCountsByZone(tenantId: string): Promise<Map<string | null, number>> {
  const rows = await prisma.building.groupBy({
    by: ['zoneId'],
    where: { tenantId, deletedAt: null },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.zoneId, r._count._all]))
}
