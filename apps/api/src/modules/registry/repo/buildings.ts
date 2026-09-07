import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import { pageArgs } from '../../../platform/http/pagination.js'
import type { GeocodeStatus, Prisma } from '../../../generated/prisma/index.js'

const withCounts = {
  customer: { select: { name: true } },
  _count: { select: { elevators: { where: { deletedAt: null } } } },
} as const

export function listBuildings(
  tenantId: string,
  q: {
    cursor?: string
    limit: number
    q?: string
    customerId?: string
    geocodeStatus?: GeocodeStatus
  },
) {
  const where: Prisma.BuildingWhereInput = {
    tenantId,
    deletedAt: null,
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.geocodeStatus ? { geocodeStatus: q.geocodeStatus } : {}),
    ...(q.q ? { addressText: { contains: q.q, mode: 'insensitive' } } : {}),
  }
  return prisma.building.findMany({ ...pageArgs(q), where, include: withCounts })
}

export function buildingsForCustomer(tenantId: string, customerId: string) {
  return prisma.building.findMany({
    where: { tenantId, customerId, deletedAt: null },
    include: withCounts,
    orderBy: { addressText: 'asc' },
  })
}

export function findBuilding(tenantId: string, id: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.building.findFirst({ where: { id, tenantId, deletedAt: null }, include: withCounts })
}

export function findBuildingByAddressText(tenantId: string, addressText: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.building.findFirst({
    where: { tenantId, deletedAt: null, addressText: { equals: addressText, mode: 'insensitive' } },
  })
}

export type BuildingData = Omit<Prisma.BuildingUncheckedCreateInput, 'id' | 'tenantId'>

export function createBuilding(tenantId: string, data: BuildingData, tx?: Tx) {
  const db = tx ?? prisma
  return db.building.create({ data: { id: newId(), tenantId, ...data }, include: withCounts })
}

export function updateBuilding(
  tenantId: string,
  id: string,
  data: Prisma.BuildingUncheckedUpdateInput,
) {
  return prisma.building.update({ where: { id, tenantId }, data, include: withCounts })
}

export function buildingPins(tenantId: string) {
  return prisma.building.findMany({
    where: { tenantId, deletedAt: null, lat: { not: null }, lng: { not: null } },
    select: {
      id: true,
      addressText: true,
      lat: true,
      lng: true,
      _count: { select: { elevators: { where: { deletedAt: null } } } },
    },
  })
}

export function countBuildings(tenantId: string) {
  return prisma.building.count({ where: { tenantId, deletedAt: null } })
}
