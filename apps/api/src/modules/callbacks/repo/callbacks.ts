import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type {
  CallbackStatus,
  ChargeReason,
  EventSource,
  Prisma,
} from '../../../generated/prisma/index.js'

const withRelations = {
  elevator: { select: { internalNo: true } },
  building: { select: { addressText: true } },
} satisfies Prisma.CallbackInclude

const withEvents = {
  ...withRelations,
  events: { orderBy: [{ at: 'asc' }, { receivedAt: 'asc' }] },
} satisfies Prisma.CallbackInclude

export type CallbackRow = Prisma.CallbackGetPayload<{ include: typeof withRelations }>
export type CallbackDetailRow = Prisma.CallbackGetPayload<{ include: typeof withEvents }>

export function findCallback(tenantId: string, id: string, tx?: Tx): Promise<CallbackRow | null> {
  const db = tx ?? prisma
  return db.callback.findFirst({ where: { id, tenantId }, include: withRelations })
}

export function findCallbackDetail(
  tenantId: string,
  id: string,
): Promise<CallbackDetailRow | null> {
  return prisma.callback.findFirst({ where: { id, tenantId }, include: withEvents })
}

export interface ListFilter {
  cursor?: string
  limit: number
  status?: CallbackStatus
  open?: boolean
  elevatorId?: string
  buildingId?: string
  assignedUserId?: string
  /** Technician view: assigned to or opened by this user. */
  visibleToUserId?: string
  from?: Date
  to?: Date
}

/** Keyset pagination over (receivedAt DESC, id DESC); cursor = `<receivedAt ISO>|<id>`. */
export function listCallbacks(tenantId: string, q: ListFilter): Promise<CallbackRow[]> {
  const cursor = parseCursor(q.cursor)
  const where: Prisma.CallbackWhereInput = {
    tenantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.open === true ? { status: { not: 'closed' } } : {}),
    ...(q.open === false ? { status: 'closed' } : {}),
    ...(q.elevatorId ? { elevatorId: q.elevatorId } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
    ...(q.visibleToUserId
      ? { OR: [{ assignedUserId: q.visibleToUserId }, { createdByUserId: q.visibleToUserId }] }
      : {}),
    ...(q.from || q.to
      ? { receivedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } }
      : {}),
    ...(cursor
      ? {
          AND: [
            {
              OR: [
                { receivedAt: { lt: cursor.receivedAt } },
                { receivedAt: cursor.receivedAt, id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : {}),
  }
  return prisma.callback.findMany({
    where,
    include: withRelations,
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  })
}

export function cursorOf(c: { receivedAt: Date; id: string }): string {
  return `${c.receivedAt.toISOString()}|${c.id}`
}

function parseCursor(c: string | undefined): { receivedAt: Date; id: string } | null {
  if (!c) return null
  const i = c.lastIndexOf('|')
  if (i === -1) return null
  const receivedAt = new Date(c.slice(0, i))
  if (Number.isNaN(receivedAt.getTime())) return null
  return { receivedAt, id: c.slice(i + 1) }
}

/** Every open callback (dashboard summary, calendar, pins) - oldest first. */
export function listOpen(tenantId: string): Promise<CallbackRow[]> {
  return prisma.callback.findMany({
    where: { tenantId, status: { not: 'closed' } },
    include: withRelations,
    orderBy: [{ receivedAt: 'asc' }],
  })
}

export interface CallbackInput {
  id?: string
  elevatorId: string
  buildingId: string
  channel: 'phone' | 'public_page' | 'office'
  callerName: string | null
  callerPhone: string | null
  classification: 'trapped_persons' | 'breakdown' | 'complaint' | 'other'
  trappedCount: number | null
  description: string
  status: CallbackStatus
  receivedAt: Date
  dispatchedAt: Date | null
  assignedUserId: string | null
  notes: string | null
  slaMinutes: number
  source: EventSource
  createdByUserId: string | null
}

export function createCallback(tenantId: string, c: CallbackInput, tx?: Tx): Promise<CallbackRow> {
  const db = tx ?? prisma
  const { id, ...rest } = c
  return db.callback.create({
    data: { id: id ?? newId(), tenantId, ...rest },
    include: withRelations,
  })
}

export interface CallbackPatch {
  status?: CallbackStatus
  dispatchedAt?: Date | null
  onSiteAt?: Date | null
  releasedAt?: Date | null
  restoredAt?: Date | null
  closedAt?: Date | null
  assignedUserId?: string | null
  cause?: string | null
  actionTaken?: string | null
  chargeable?: boolean
  chargeReason?: ChargeReason | null
  notes?: string | null
  closeoutVisitId?: string | null
}

export function updateCallback(
  tenantId: string,
  id: string,
  data: CallbackPatch,
  tx?: Tx,
): Promise<CallbackRow> {
  const db = tx ?? prisma
  return db.callback.update({ where: { id, tenantId }, data, include: withRelations })
}

export interface EventInput {
  callbackId: string
  type: string
  at: Date
  source: EventSource
  byUserId: string | null
  data?: Record<string, unknown>
}

export function appendEvent(tenantId: string, e: EventInput, tx?: Tx) {
  const db = tx ?? prisma
  return db.callbackEvent.create({
    data: {
      id: newId(),
      tenantId,
      callbackId: e.callbackId,
      type: e.type,
      at: e.at,
      source: e.source,
      byUserId: e.byUserId,
      data: (e.data ?? {}) as object,
    },
  })
}

export function countCallbacks(tenantId: string, where: Prisma.CallbackWhereInput = {}) {
  return prisma.callback.count({ where: { tenantId, ...where } })
}
