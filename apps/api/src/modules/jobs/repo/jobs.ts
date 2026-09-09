import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type {
  EventSource,
  JobKind,
  JobLineKind,
  JobOriginType,
  Prisma,
} from '../../../generated/prisma/index.js'

const withRelations = {
  elevator: { select: { internalNo: true } },
  building: { select: { addressText: true, customerId: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.JobInclude

const withDetail = {
  ...withRelations,
  lines: { orderBy: [{ quoteVersion: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }] },
  events: { orderBy: [{ at: 'asc' }, { receivedAt: 'asc' }] },
} satisfies Prisma.JobInclude

export type JobRow = Prisma.JobGetPayload<{ include: typeof withRelations }>
export type JobDetailRow = Prisma.JobGetPayload<{ include: typeof withDetail }>
export type JobLineRow = Prisma.JobLineGetPayload<Record<string, never>>
export type JobEventRow = Prisma.JobEventGetPayload<Record<string, never>>

export function findJob(tenantId: string, id: string, tx?: Tx): Promise<JobRow | null> {
  const db = tx ?? prisma
  return db.job.findFirst({ where: { id, tenantId }, include: withRelations })
}

export function findJobDetail(tenantId: string, id: string, tx?: Tx): Promise<JobDetailRow | null> {
  const db = tx ?? prisma
  return db.job.findFirst({ where: { id, tenantId }, include: withDetail })
}

export interface ListFilter {
  cursor?: string
  limit: number
  statuses?: string[]
  elevatorId?: string
  buildingId?: string
  customerId?: string
  assignedUserId?: string
  kind?: JobKind
  originType?: JobOriginType
  originId?: string
  q?: string
  from?: Date
  to?: Date
  /** Technician view: assigned to this user. */
  visibleToUserId?: string
}

/** Keyset pagination over (createdAt DESC, id DESC); cursor = `<createdAt ISO>|<id>`. */
export function listJobs(tenantId: string, q: ListFilter): Promise<JobRow[]> {
  const cursor = parseCursor(q.cursor)
  const where: Prisma.JobWhereInput = {
    tenantId,
    ...(q.statuses && q.statuses.length ? { status: { in: q.statuses } } : {}),
    ...(q.elevatorId ? { elevatorId: q.elevatorId } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.assignedUserId ? { assignedUserIds: { has: q.assignedUserId } } : {}),
    ...(q.visibleToUserId ? { assignedUserIds: { has: q.visibleToUserId } } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.originType ? { originType: q.originType } : {}),
    ...(q.originId ? { originId: q.originId } : {}),
    ...(q.q
      ? {
          OR: [
            { title: { contains: q.q, mode: 'insensitive' } },
            { description: { contains: q.q, mode: 'insensitive' } },
            { building: { addressText: { contains: q.q, mode: 'insensitive' } } },
            { elevator: { internalNo: { contains: q.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
      : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  }
  return prisma.job.findMany({
    where,
    include: withRelations,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  })
}

export function cursorOf(j: { createdAt: Date; id: string }): string {
  return `${j.createdAt.toISOString()}|${j.id}`
}

function parseCursor(c: string | undefined): { createdAt: Date; id: string } | null {
  if (!c) return null
  const i = c.lastIndexOf('|')
  if (i === -1) return null
  const createdAt = new Date(c.slice(0, i))
  if (Number.isNaN(createdAt.getTime())) return null
  return { createdAt, id: c.slice(i + 1) }
}

/** Every job in one of the given stages (dashboard summary, reminders, calendar). */
export function listByStatuses(tenantId: string, statuses: string[]): Promise<JobRow[]> {
  return prisma.job.findMany({
    where: { tenantId, status: { in: statuses } },
    include: withRelations,
    orderBy: [{ updatedAt: 'asc' }],
  })
}

/** Jobs created from an origin (defect / callback / visit), for the "already has a job" links. */
export function listByOrigins(
  tenantId: string,
  originType: JobOriginType,
  originIds: string[],
): Promise<JobRow[]> {
  if (originIds.length === 0) return Promise.resolve([])
  return prisma.job.findMany({
    where: { tenantId, originType, originId: { in: originIds } },
    include: withRelations,
    orderBy: [{ createdAt: 'desc' }],
  })
}

/** Sync pull: jobs assigned to the user in the given stages (full replace on the phone). */
export function listForSync(
  tenantId: string,
  userId: string,
  statuses: string[],
  limit = 200,
): Promise<JobRow[]> {
  return prisma.job.findMany({
    where: { tenantId, status: { in: statuses }, assignedUserIds: { has: userId } },
    include: withRelations,
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  })
}

export interface JobInput {
  id?: string
  elevatorId: string
  buildingId: string
  customerId: string | null
  kind: JobKind
  title: string
  description: string | null
  originType: JobOriginType
  originId: string | null
  vatRatePercent: number
  notes: string | null
  createdByUserId: string | null
}

export function createJob(tenantId: string, j: JobInput, tx?: Tx): Promise<JobRow> {
  const db = tx ?? prisma
  const { id, ...rest } = j
  return db.job.create({
    data: { id: id ?? newId(), tenantId, ...rest, assignedUserIds: [] },
    include: withRelations,
  })
}

export type JobPatch = Omit<
  Prisma.JobUncheckedUpdateInput,
  'id' | 'tenantId' | 'createdAt' | 'lines' | 'events'
>

export function updateJob(tenantId: string, id: string, data: JobPatch, tx?: Tx): Promise<JobRow> {
  const db = tx ?? prisma
  return db.job.update({ where: { id, tenantId }, data, include: withRelations })
}

export function countJobs(tenantId: string, where: Prisma.JobWhereInput = {}) {
  return prisma.job.count({ where: { tenantId, ...where } })
}

// ---- lines ------------------------------------------------------------------------------------

export function linesOf(
  tenantId: string,
  jobId: string,
  quoteVersion: number,
  tx?: Tx,
): Promise<JobLineRow[]> {
  const db = tx ?? prisma
  return db.jobLine.findMany({
    where: { tenantId, jobId, quoteVersion },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  })
}

export function findLine(tenantId: string, jobId: string, id: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.jobLine.findFirst({ where: { id, tenantId, jobId } })
}

export interface LineInput {
  jobId: string
  quoteVersion: number
  kind: JobLineKind
  description: string
  qty: number
  unitCents: number
  totalCents: number
  partRef: string | null
  position: number
}

export function createLine(tenantId: string, l: LineInput, tx?: Tx): Promise<JobLineRow> {
  const db = tx ?? prisma
  return db.jobLine.create({ data: { id: newId(), tenantId, ...l } })
}

export function updateLine(
  tenantId: string,
  id: string,
  data: Prisma.JobLineUncheckedUpdateInput,
  tx?: Tx,
): Promise<JobLineRow> {
  const db = tx ?? prisma
  return db.jobLine.update({ where: { id, tenantId }, data })
}

export function deleteLine(tenantId: string, id: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.jobLine.delete({ where: { id, tenantId } })
}

// ---- events -----------------------------------------------------------------------------------

export interface EventInput {
  jobId: string
  type: string
  fromStatus?: string | null
  toStatus?: string | null
  at: Date
  source: EventSource
  byUserId: string | null
  data?: Record<string, unknown>
}

export function appendEvent(tenantId: string, e: EventInput, tx?: Tx): Promise<JobEventRow> {
  const db = tx ?? prisma
  return db.jobEvent.create({
    data: {
      id: newId(),
      tenantId,
      jobId: e.jobId,
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      at: e.at,
      source: e.source,
      byUserId: e.byUserId,
      data: (e.data ?? {}) as object,
    },
  })
}
