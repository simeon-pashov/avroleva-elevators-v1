import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type {
  DefectSeverity,
  DefectSource,
  DefectStatus,
  Prisma,
} from '../../../generated/prisma/index.js'

const withRelations = {
  elevator: { select: { internalNo: true, status: true } },
  building: { select: { addressText: true } },
} as const

export type DefectRow = Prisma.DefectGetPayload<{ include: typeof withRelations }>

export function findDefect(tenantId: string, id: string, tx?: Tx): Promise<DefectRow | null> {
  const db = tx ?? prisma
  return db.defect.findFirst({ where: { id, tenantId }, include: withRelations })
}

export interface ListFilter {
  cursor?: string
  limit: number
  status?: DefectStatus
  open?: boolean
  elevatorId?: string
  buildingId?: string
  stopLift?: boolean
  /** Open defects with followUpDueAt <= this date. */
  followUpDueBy?: Date
}

/** Keyset pagination over (recordedAt DESC, id DESC); cursor = `<recordedAt ISO>|<id>`. */
export function listDefects(tenantId: string, q: ListFilter): Promise<DefectRow[]> {
  const cursor = parseCursor(q.cursor)
  const where: Prisma.DefectWhereInput = {
    tenantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.open === true ? { status: { not: 'resolved' } } : {}),
    ...(q.open === false ? { status: 'resolved' } : {}),
    ...(q.elevatorId ? { elevatorId: q.elevatorId } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.stopLift !== undefined ? { stopLift: q.stopLift } : {}),
    ...(q.followUpDueBy
      ? { status: { not: 'resolved' }, followUpDueAt: { lte: q.followUpDueBy } }
      : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { recordedAt: { lt: cursor.recordedAt } },
                { recordedAt: cursor.recordedAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  }
  return prisma.defect.findMany({
    where,
    include: withRelations,
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  })
}

export function cursorOf(d: { recordedAt: Date; id: string }): string {
  return `${d.recordedAt.toISOString()}|${d.id}`
}

function parseCursor(c: string | undefined): { recordedAt: Date; id: string } | null {
  if (!c) return null
  const i = c.lastIndexOf('|')
  if (i === -1) return null
  const recordedAt = new Date(c.slice(0, i))
  if (Number.isNaN(recordedAt.getTime())) return null
  return { recordedAt, id: c.slice(i + 1) }
}

/** Every open defect (dashboard summary, calendar, pins). */
export function listOpen(tenantId: string, tx?: Tx): Promise<DefectRow[]> {
  const db = tx ?? prisma
  return db.defect.findMany({
    where: { tenantId, status: { not: 'resolved' } },
    include: withRelations,
    orderBy: [{ followUpDueAt: 'asc' }, { recordedAt: 'asc' }],
  })
}

export function countOpenStopLift(tenantId: string, elevatorId: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.defect.count({
    where: { tenantId, elevatorId, stopLift: true, status: { not: 'resolved' } },
  })
}

export interface DefectInput {
  elevatorId: string
  buildingId: string
  catalogCode: string | null
  description: string
  severity: DefectSeverity
  stopLift: boolean
  recordedAt: Date
  sourceType: DefectSource
  sourceId: string | null
  followUpDueAt: Date
  notes: string | null
  createdByUserId: string | null
}

export function createDefect(tenantId: string, d: DefectInput, tx?: Tx): Promise<DefectRow> {
  const db = tx ?? prisma
  return db.defect.create({ data: { id: newId(), tenantId, ...d }, include: withRelations })
}

export function updateDefect(
  tenantId: string,
  id: string,
  data: Prisma.DefectUncheckedUpdateInput,
  tx?: Tx,
): Promise<DefectRow> {
  const db = tx ?? prisma
  return db.defect.update({ where: { id, tenantId }, data, include: withRelations })
}
