import { prisma } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { DayPlanStatus, Prisma } from '../../../generated/prisma/index.js'

const withPair = {
  pair: { select: { id: true, name: true, position: true } },
} satisfies Prisma.DayPlanInclude

export type PlanRow = Prisma.DayPlanGetPayload<{ include: typeof withPair }>

const order = [{ pair: { position: 'asc' } }, { createdAt: 'asc' }] satisfies
  Prisma.DayPlanOrderByWithRelationInput | Prisma.DayPlanOrderByWithRelationInput[]

/** Plans of one day; with a zone: that zone's plans plus the ones planned for every zone. */
export function listForDate(
  tenantId: string,
  date: Date,
  zoneId?: string | null,
): Promise<PlanRow[]> {
  return prisma.dayPlan.findMany({
    where: {
      tenantId,
      date,
      ...(zoneId ? { OR: [{ zoneId }, { zoneId: null }] } : {}),
    },
    include: withPair,
    orderBy: order,
  })
}

export function findPlan(tenantId: string, id: string): Promise<PlanRow | null> {
  return prisma.dayPlan.findFirst({ where: { id, tenantId }, include: withPair })
}

export function findPlansByIds(tenantId: string, ids: string[]): Promise<PlanRow[]> {
  if (ids.length === 0) return Promise.resolve([])
  return prisma.dayPlan.findMany({
    where: { tenantId, id: { in: ids } },
    include: withPair,
    orderBy: order,
  })
}

export function findByPair(tenantId: string, date: Date, pairId: string): Promise<PlanRow | null> {
  return prisma.dayPlan.findFirst({ where: { tenantId, date, pairId }, include: withPair })
}

/** Published plans of the given days that list the user (the technician app, `mine`). */
export function listPublishedForUser(
  tenantId: string,
  userId: string,
  dates: Date[],
): Promise<PlanRow[]> {
  if (dates.length === 0) return Promise.resolve([])
  return prisma.dayPlan.findMany({
    where: { tenantId, status: 'published', date: { in: dates }, userIds: { has: userId } },
    include: withPair,
    orderBy: [{ date: 'asc' }, ...order],
  })
}

export function listByStatusForDate(
  tenantId: string,
  date: Date,
  status: DayPlanStatus,
): Promise<PlanRow[]> {
  return prisma.dayPlan.findMany({
    where: { tenantId, date, status },
    include: withPair,
    orderBy: order,
  })
}

export type PlanData = Omit<Prisma.DayPlanUncheckedCreateInput, 'id' | 'tenantId'>

export function createPlan(tenantId: string, data: PlanData): Promise<PlanRow> {
  return prisma.dayPlan.create({ data: { id: newId(), tenantId, ...data }, include: withPair })
}

export function updatePlan(
  tenantId: string,
  id: string,
  data: Prisma.DayPlanUncheckedUpdateInput,
): Promise<PlanRow> {
  return prisma.dayPlan.update({ where: { id, tenantId }, data, include: withPair })
}
