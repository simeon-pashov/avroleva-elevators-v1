import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId, newPublicCode } from '../../../platform/ids.js'
import { pageArgs } from '../../../platform/http/pagination.js'
import type { ElevatorStatus, Prisma } from '../../../generated/prisma/index.js'

const withBuilding = { building: { select: { addressText: true } } } as const

export function listElevators(
  tenantId: string,
  q: { cursor?: string; limit: number; q?: string; buildingId?: string; status?: ElevatorStatus },
) {
  const where: Prisma.ElevatorWhereInput = {
    tenantId,
    deletedAt: null,
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          OR: [
            { internalNo: { contains: q.q, mode: 'insensitive' } },
            { regNo: { contains: q.q, mode: 'insensitive' } },
            { building: { addressText: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  return prisma.elevator.findMany({ ...pageArgs(q), where, include: withBuilding })
}

export function elevatorsForBuilding(tenantId: string, buildingId: string) {
  return prisma.elevator.findMany({
    where: { tenantId, buildingId, deletedAt: null },
    include: withBuilding,
    orderBy: { internalNo: 'asc' },
  })
}

export function findElevator(tenantId: string, id: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.elevator.findFirst({ where: { id, tenantId, deletedAt: null }, include: withBuilding })
}

export function findElevatorsByIds(tenantId: string, ids: string[], tx?: Tx) {
  const db = tx ?? prisma
  return db.elevator.findMany({ where: { tenantId, deletedAt: null, id: { in: ids } } })
}

export type ElevatorData = Omit<
  Prisma.ElevatorUncheckedCreateInput,
  'id' | 'tenantId' | 'publicCode'
>

export async function createElevator(tenantId: string, data: ElevatorData, tx?: Tx) {
  const db = tx ?? prisma
  // publicCode is unique per tenant; retry on the (astronomically rare) collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.elevator.create({
        data: { id: newId(), tenantId, publicCode: newPublicCode(), ...data },
        include: withBuilding,
      })
    } catch (err) {
      if (attempt === 2 || (err as { code?: string }).code !== 'P2002') throw err
    }
  }
  throw new Error('unreachable')
}

export function updateElevator(
  tenantId: string,
  id: string,
  data: Prisma.ElevatorUncheckedUpdateInput,
) {
  return prisma.elevator.update({ where: { id, tenantId }, data, include: withBuilding })
}

export function updateElevatorsStatus(
  tenantId: string,
  ids: string[],
  status: ElevatorStatus,
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.elevator.updateMany({
    where: { tenantId, id: { in: ids }, deletedAt: null },
    data: { status },
  })
}

export function findByRegNoNormalized(
  tenantId: string,
  regNoNormalized: string,
  excludeId?: string,
) {
  return prisma.elevator.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      regNoNormalized,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, internalNo: true },
  })
}

export function countElevators(tenantId: string) {
  return prisma.elevator.count({ where: { tenantId, deletedAt: null } })
}
