import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { InspectionResult, Prisma } from '../../../generated/prisma/index.js'

const withRelations = {
  elevator: { select: { internalNo: true, building: { select: { id: true, addressText: true } } } },
} as const

export type InspectionRow = Prisma.InspectionGetPayload<{ include: typeof withRelations }>

export function findInspection(
  tenantId: string,
  id: string,
  tx?: Tx,
): Promise<InspectionRow | null> {
  const db = tx ?? prisma
  return db.inspection.findFirst({ where: { id, tenantId }, include: withRelations })
}

export interface ListFilter {
  cursor?: string
  limit: number
  elevatorId?: string
  buildingId?: string
  result?: InspectionResult
  from?: Date
  to?: Date
}

/** Newest first by the most meaningful date (performedAt, else scheduledAt, else createdAt) - id keyset. */
export function listInspections(tenantId: string, q: ListFilter): Promise<InspectionRow[]> {
  const where: Prisma.InspectionWhereInput = {
    tenantId,
    ...(q.elevatorId ? { elevatorId: q.elevatorId } : {}),
    ...(q.buildingId ? { elevator: { buildingId: q.buildingId } } : {}),
    ...(q.result ? { result: q.result } : {}),
    ...(q.from || q.to
      ? {
          OR: [
            { performedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } },
            {
              performedAt: null,
              scheduledAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) },
            },
          ],
        }
      : {}),
    ...(q.cursor ? { id: { lt: q.cursor } } : {}),
  }
  return prisma.inspection.findMany({
    where,
    include: withRelations,
    orderBy: [{ id: 'desc' }],
    take: q.limit + 1,
  })
}

/** Latest performed inspection of an elevator (drives elevator.nextInspectionAt). */
export function latestPerformed(tenantId: string, elevatorId: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.inspection.findFirst({
    where: { tenantId, elevatorId, performedAt: { not: null } },
    orderBy: [{ performedAt: 'desc' }, { id: 'desc' }],
  })
}

export function countPerformed(tenantId: string, elevatorId: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.inspection.count({ where: { tenantId, elevatorId, performedAt: { not: null } } })
}

export type InspectionData = Omit<Prisma.InspectionUncheckedCreateInput, 'id' | 'tenantId'>

export function createInspection(tenantId: string, data: InspectionData, tx?: Tx) {
  const db = tx ?? prisma
  return db.inspection.create({ data: { id: newId(), tenantId, ...data }, include: withRelations })
}

export function updateInspection(
  tenantId: string,
  id: string,
  data: Prisma.InspectionUncheckedUpdateInput,
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.inspection.update({ where: { id, tenantId }, data, include: withRelations })
}

/** Scheduled-but-not-performed inspections (calendar: they are the concrete dates). */
export function listScheduled(tenantId: string) {
  return prisma.inspection.findMany({
    where: { tenantId, performedAt: null, scheduledAt: { not: null } },
    include: withRelations,
  })
}

// ---- alarm-device tests

export function createAlarmTest(
  tenantId: string,
  data: {
    elevatorId: string
    testedAt: Date
    ok: boolean
    notes: string | null
    byUserId: string | null
  },
) {
  return prisma.alarmDeviceTest.create({ data: { id: newId(), tenantId, ...data } })
}

export function listAlarmTests(tenantId: string, elevatorId: string, limit = 50) {
  return prisma.alarmDeviceTest.findMany({
    where: { tenantId, elevatorId },
    orderBy: [{ testedAt: 'desc' }],
    take: limit,
  })
}

/** Latest test per elevator in one query (calendar: alarm tests due). */
export async function latestAlarmTests(tenantId: string): Promise<Map<string, Date>> {
  const rows = await prisma.alarmDeviceTest.groupBy({
    by: ['elevatorId'],
    where: { tenantId },
    _max: { testedAt: true },
  })
  const map = new Map<string, Date>()
  for (const r of rows) if (r._max.testedAt) map.set(r.elevatorId, r._max.testedAt)
  return map
}
