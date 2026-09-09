import { prisma } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { Prisma, TechnicianPair } from '../../../generated/prisma/index.js'

export type PairRow = TechnicianPair

export function listPairs(
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<PairRow[]> {
  return prisma.technicianPair.findMany({
    where: { tenantId, deletedAt: null, ...(opts.activeOnly ? { active: true } : {}) },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })
}

export function findPair(tenantId: string, id: string): Promise<PairRow | null> {
  return prisma.technicianPair.findFirst({ where: { id, tenantId, deletedAt: null } })
}

/** Rows for a set of ids, archived ones included (a plan keeps its pair after archiving). */
export function findPairsByIds(tenantId: string, ids: string[]): Promise<PairRow[]> {
  if (ids.length === 0) return Promise.resolve([])
  return prisma.technicianPair.findMany({
    where: { tenantId, id: { in: ids } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })
}

export type PairData = Omit<Prisma.TechnicianPairUncheckedCreateInput, 'id' | 'tenantId'>

export function createPair(tenantId: string, data: PairData): Promise<PairRow> {
  return prisma.technicianPair.create({ data: { id: newId(), tenantId, ...data } })
}

export function updatePair(
  tenantId: string,
  id: string,
  data: Prisma.TechnicianPairUncheckedUpdateInput,
): Promise<PairRow> {
  return prisma.technicianPair.update({ where: { id, tenantId }, data })
}

export async function maxPosition(tenantId: string): Promise<number> {
  const r = await prisma.technicianPair.aggregate({
    where: { tenantId, deletedAt: null },
    _max: { position: true },
  })
  return r._max.position ?? -1
}
