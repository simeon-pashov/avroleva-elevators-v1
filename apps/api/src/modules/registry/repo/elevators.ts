import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId, newPublicCode } from '../../../platform/ids.js'
import { pageArgs } from '../../../platform/http/pagination.js'
import type { ElevatorStatus, Prisma } from '../../../generated/prisma/index.js'

const withBuilding = { building: { select: { addressText: true } } } as const

/** Detail/popup view: building + house-manager contact + customer + active contract line. */
const withDetail = {
  building: {
    select: {
      id: true,
      addressText: true,
      address: true,
      lat: true,
      lng: true,
      customerId: true,
      customer: { select: { id: true, name: true } },
      contacts: {
        where: { deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }, { id: 'asc' }],
        take: 5,
        select: { id: true, name: true, phone: true, role: true, isPrimary: true },
      },
    },
  },
  contractLines: {
    where: { toDate: null, contract: { status: 'active', deletedAt: null } },
    select: { contractId: true, monthlyPriceCents: true },
    take: 1,
  },
} satisfies Prisma.ElevatorInclude

export type ElevatorDetailRow = Prisma.ElevatorGetPayload<{ include: typeof withDetail }>

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

export function findElevatorDetail(
  tenantId: string,
  id: string,
): Promise<ElevatorDetailRow | null> {
  return prisma.elevator.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: withDetail,
  })
}

export function findElevatorsByIds(tenantId: string, ids: string[], tx?: Tx) {
  const db = tx ?? prisma
  return db.elevator.findMany({ where: { tenantId, deletedAt: null, id: { in: ids } } })
}

/**
 * Read model for the due board and the map: every non-scrapped elevator with its building,
 * house-manager contact and current price. One query; ordered by building then internalNo.
 */
export function listForSchedule(tenantId: string): Promise<ElevatorDetailRow[]> {
  return prisma.elevator.findMany({
    where: { tenantId, deletedAt: null, status: { not: 'scrapped' } },
    include: withDetail,
    orderBy: [{ building: { addressText: 'asc' } }, { internalNo: 'asc' }],
  })
}

/** Minimal rows for a full recompute of nextCheckDueAt (settings change). */
export function listForRecompute(tenantId: string) {
  return prisma.elevator.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      checkIntervalDays: true,
      lastCheckAt: true,
      nextCheckOverrideAt: true,
      nextCheckDueAt: true,
    },
  })
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
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.elevator.update({ where: { id, tenantId }, data, include: withBuilding })
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
