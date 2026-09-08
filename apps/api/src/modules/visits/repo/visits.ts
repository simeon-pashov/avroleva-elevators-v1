import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import { Prisma } from '../../../generated/prisma/index.js'
import type { TimestampSource, VisitKind } from '../../../generated/prisma/index.js'

const withRelations = {
  technicians: { orderBy: { position: 'asc' as const } },
  elevator: { select: { internalNo: true } },
  building: { select: { addressText: true } },
} as const

export type VisitRow = Prisma.VisitGetPayload<{ include: typeof withRelations }>

export function findVisit(tenantId: string, id: string, tx?: Tx): Promise<VisitRow | null> {
  const db = tx ?? prisma
  return db.visit.findFirst({ where: { id, tenantId }, include: withRelations })
}

/**
 * Keyset pagination over (startedAt DESC, id DESC): the history is read newest first and the seed
 * inserts old visits in one go, so creation order (UUIDv7) is not the order the office wants.
 * Cursor = `<startedAt ISO>|<id>`.
 */
export function listVisits(
  tenantId: string,
  q: {
    cursor?: string
    limit: number
    elevatorId?: string
    buildingId?: string
    kind?: VisitKind
    from?: Date
    to?: Date
    includeSuperseded?: boolean
  },
): Promise<VisitRow[]> {
  const cursor = parseCursor(q.cursor)
  const where: Prisma.VisitWhereInput = {
    tenantId,
    ...(q.elevatorId ? { elevatorId: q.elevatorId } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.includeSuperseded ? {} : { supersededAt: null }),
    ...(q.from || q.to
      ? { startedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
      : {}),
    ...(cursor
      ? {
          OR: [
            { startedAt: { lt: cursor.startedAt } },
            { startedAt: cursor.startedAt, id: { lt: cursor.id } },
          ],
        }
      : {}),
  }
  return prisma.visit.findMany({
    where,
    include: withRelations,
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  })
}

export function cursorOf(v: { startedAt: Date; id: string }): string {
  return `${v.startedAt.toISOString()}|${v.id}`
}

function parseCursor(c: string | undefined): { startedAt: Date; id: string } | null {
  if (!c) return null
  const i = c.lastIndexOf('|')
  if (i === -1) return null
  const startedAt = new Date(c.slice(0, i))
  if (Number.isNaN(startedAt.getTime())) return null
  return { startedAt, id: c.slice(i + 1) }
}

export interface VisitInput {
  id?: string
  elevatorId: string
  buildingId: string
  kind: VisitKind
  startedAt: Date
  endedAt: Date | null
  notes: string | null
  source: 'office' | 'paper' | 'app'
  timestampSource: TimestampSource
  clientOffsetMs: number
  templateKey: string | null
  templateVersion: number | null
  checklist: unknown | null
  gps: unknown | null
  qualityFlags: string[]
  createdByUserId: string | null
  supersedesVisitId?: string | null
  technicians: Array<{ userId: string | null; name: string }>
}

export function createVisit(tenantId: string, v: VisitInput, tx?: Tx): Promise<VisitRow> {
  const db = tx ?? prisma
  return db.visit.create({
    data: {
      id: v.id ?? newId(),
      tenantId,
      elevatorId: v.elevatorId,
      buildingId: v.buildingId,
      kind: v.kind,
      startedAt: v.startedAt,
      endedAt: v.endedAt,
      notes: v.notes,
      source: v.source,
      timestampSource: v.timestampSource,
      clientOffsetMs: v.clientOffsetMs,
      templateKey: v.templateKey,
      templateVersion: v.templateVersion,
      checklist: v.checklist == null ? Prisma.JsonNull : (v.checklist as object),
      gps: v.gps == null ? Prisma.JsonNull : (v.gps as object),
      qualityFlags: v.qualityFlags,
      createdByUserId: v.createdByUserId,
      supersedesVisitId: v.supersedesVisitId ?? null,
      technicians: {
        create: v.technicians.map((t, i) => ({
          id: newId(),
          tenantId,
          userId: t.userId,
          position: i + 1,
          name: t.name,
        })),
      },
    },
    include: withRelations,
  })
}

/** Sync pull: rows received (server clock) since the watermark, newest first. */
export function listReceivedSince(tenantId: string, since: Date, limit: number) {
  return prisma.visit.findMany({
    where: { tenantId, createdAt: { gte: since } },
    include: withRelations,
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
  })
}

export function markSuperseded(tenantId: string, id: string, at: Date, tx?: Tx) {
  const db = tx ?? prisma
  return db.visit.update({ where: { id, tenantId }, data: { supersededAt: at } })
}

/** Latest visit of any kind (public page: "last visit date"). */
export function latestVisit(tenantId: string, elevatorId: string) {
  return prisma.visit.findFirst({
    where: { tenantId, elevatorId, supersededAt: null },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  })
}

/** Latest check visit per elevator (history sanity checks, seeds). */
export function latestCheckVisit(tenantId: string, elevatorId: string) {
  return prisma.visit.findFirst({
    where: {
      tenantId,
      elevatorId,
      supersededAt: null,
      kind: { in: ['functional_check', 'technical_maintenance'] },
    },
    orderBy: { startedAt: 'desc' },
  })
}

export function countVisits(tenantId: string, elevatorId?: string) {
  return prisma.visit.count({
    where: { tenantId, supersededAt: null, ...(elevatorId ? { elevatorId } : {}) },
  })
}
