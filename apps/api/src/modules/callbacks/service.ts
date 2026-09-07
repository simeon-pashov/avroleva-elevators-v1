import type {
  CallbackDetailDto,
  CallbackDto,
  CallbackEventDto,
  CallbackListQuery,
  CallbacksSummaryDto,
  CloseCallbackBody,
  CreateCallbackBody,
  EventSource,
  Page,
  UserRole,
} from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import type { AuditActor } from '../../platform/audit.js'
import { addDays, clock, fromDateOnly } from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { logger } from '../../platform/logger.js'
import { transaction } from '../../platform/db/prisma.js'
import type { Tx } from '../../platform/db/prisma.js'
import { findUsersByIds, getTenantSettings } from '../tenancy/index.js'
import { elevators } from '../registry/index.js'
import * as repo from './repo/callbacks.js'
import type { CallbackDetailRow, CallbackRow } from './repo/callbacks.js'
import { canTransition, elapsedMinutes, responseMinutes, slaState } from './domain/sla.js'
import type { TransitionType } from './domain/sla.js'
import { visitRecorder } from './domain/ports.js'

const MAX_FUTURE_MS = 60 * 60 * 1000

/**
 * Who is acting: an office / technician session (Ctx) or the public page (no user). The public
 * facade builds one from the token's tenant; every timestamp carries this as its provenance.
 */
export interface CallbackActor {
  tenantId: string
  userId: string | null
  role: UserRole | null
  source: EventSource
  requestId?: string
  ip?: string
}

export function actorFromCtx(ctx: Ctx, source: EventSource = 'office'): CallbackActor {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    role: ctx.role,
    source,
    requestId: ctx.requestId,
    ip: ctx.ip,
  }
}

function auditActor(a: CallbackActor): AuditActor {
  return {
    tenantId: a.tenantId,
    actorType: a.userId ? 'user' : 'public',
    actorId: a.userId,
    requestId: a.requestId,
    ip: a.ip,
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export function toCallbackDto(
  c: CallbackRow,
  now: Date,
  userNames: Map<string, string> = new Map(),
): CallbackDto {
  return {
    id: c.id,
    elevatorId: c.elevatorId,
    elevatorInternalNo: c.elevator.internalNo,
    buildingId: c.buildingId,
    buildingAddressText: c.building.addressText,
    channel: c.channel,
    callerName: c.callerName,
    callerPhone: c.callerPhone,
    classification: c.classification,
    trappedCount: c.trappedCount,
    description: c.description,
    status: c.status,
    receivedAt: c.receivedAt.toISOString(),
    dispatchedAt: iso(c.dispatchedAt),
    onSiteAt: iso(c.onSiteAt),
    releasedAt: iso(c.releasedAt),
    restoredAt: iso(c.restoredAt),
    closedAt: iso(c.closedAt),
    assignedUserId: c.assignedUserId,
    assignedUserName: c.assignedUserId ? (userNames.get(c.assignedUserId) ?? null) : null,
    cause: c.cause,
    actionTaken: c.actionTaken,
    chargeable: c.chargeable,
    chargeReason: c.chargeReason,
    notes: c.notes,
    closeoutVisitId: c.closeoutVisitId,
    slaMinutes: c.slaMinutes,
    responseMinutes: responseMinutes(c),
    elapsedMinutes: elapsedMinutes(c, now),
    slaState: slaState(c, now),
    source: c.source,
    createdAt: c.createdAt.toISOString(),
  }
}

function toEventDto(
  e: CallbackDetailRow['events'][number],
  userNames: Map<string, string>,
): CallbackEventDto {
  return {
    id: e.id,
    type: e.type,
    at: e.at.toISOString(),
    receivedAt: e.receivedAt.toISOString(),
    source: e.source,
    byUserId: e.byUserId,
    byUserName: e.byUserId ? (userNames.get(e.byUserId) ?? null) : null,
    data: (e.data ?? {}) as Record<string, unknown>,
  }
}

async function namesFor(tenantId: string, ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  const users = await findUsersByIds(tenantId, unique)
  return new Map(users.map((u) => [u.id, u.name]))
}

function parseAt(at: string | undefined, now: Date, code: string): Date {
  if (!at) return now
  const d = new Date(at)
  if (d.getTime() > now.getTime() + MAX_FUTURE_MS) throw new AppError(400, code)
  return d
}

// ---- intake --------------------------------------------------------------------------------

/**
 * Opens a callback (office phone intake, technician's own phone, public page). Idempotent on a
 * client id. A technician is assigned to himself; an office user may dispatch on intake.
 */
export async function open(actor: CallbackActor, body: CreateCallbackBody): Promise<CallbackDto> {
  const now = clock.now()
  if (body.id) {
    const existing = await repo.findCallback(actor.tenantId, body.id)
    if (existing) return toCallbackDto(existing, now)
  }
  const elevator = await elevators.find(actor.tenantId, body.elevatorId)
  if (!elevator) throw notFound()
  const receivedAt = parseAt(body.receivedAt, now, 'callbacks.receivedInFuture')
  const settings = await getTenantSettings(actor.tenantId)

  let assignedUserId: string | null = null
  if (actor.role === 'technician') assignedUserId = actor.userId
  else if (body.assignedUserId) {
    const [u] = await findUsersByIds(actor.tenantId, [body.assignedUserId])
    if (!u || !u.isActive) throw new AppError(400, 'callbacks.userNotFound')
    assignedUserId = u.id
  }
  const created = await transaction(async (tx) => {
    const c = await repo.createCallback(
      actor.tenantId,
      {
        id: body.id,
        elevatorId: elevator.id,
        buildingId: elevator.buildingId,
        channel: body.channel,
        callerName: body.callerName ?? null,
        callerPhone: body.callerPhone ?? null,
        classification: body.classification,
        trappedCount: body.classification === 'trapped_persons' ? (body.trappedCount ?? 1) : null,
        description: body.description,
        status: assignedUserId ? 'dispatched' : 'open',
        receivedAt,
        dispatchedAt: assignedUserId ? receivedAt : null,
        assignedUserId,
        notes: body.notes ?? null,
        slaMinutes: settings.callbackSlaMinutes,
        source: actor.source,
        createdByUserId: actor.userId,
      },
      tx,
    )
    await repo.appendEvent(
      actor.tenantId,
      {
        callbackId: c.id,
        type: 'opened',
        at: receivedAt,
        source: actor.source,
        byUserId: actor.userId,
        data: { channel: c.channel, classification: c.classification },
      },
      tx,
    )
    if (assignedUserId) {
      await repo.appendEvent(
        actor.tenantId,
        {
          callbackId: c.id,
          type: 'dispatched',
          at: receivedAt,
          source: actor.source,
          byUserId: actor.userId,
          data: { userId: assignedUserId },
        },
        tx,
      )
    }
    await audit(
      auditActor(actor),
      {
        action: 'callback.open',
        entityType: 'callback',
        entityId: c.id,
        after: { elevatorId: c.elevatorId, channel: c.channel, classification: c.classification },
      },
      tx,
    )
    return c
  })
  await events.publish(actor, {
    type: 'CallbackOpened',
    aggregateType: 'callback',
    aggregateId: created.id,
    payload: {
      elevatorId: created.elevatorId,
      buildingId: created.buildingId,
      channel: created.channel,
      classification: created.classification,
      trappedCount: created.trappedCount,
      receivedAt: created.receivedAt.toISOString(),
    },
  })
  if (assignedUserId) await publishTransition(actor, created, 'dispatched')
  return toCallbackDto(created, now, await namesFor(actor.tenantId, [assignedUserId]))
}

// ---- transitions ---------------------------------------------------------------------------

async function load(actor: CallbackActor, id: string, tx?: Tx): Promise<CallbackRow> {
  const c = await repo.findCallback(actor.tenantId, id, tx)
  if (!c) throw notFound()
  // Technicians act only on callbacks assigned to them (or unassigned ones they pick up).
  if (actor.role === 'technician' && c.assignedUserId && c.assignedUserId !== actor.userId)
    throw notFound()
  return c
}

function assertTransition(c: CallbackRow, to: TransitionType) {
  if (c.status === 'closed') throw new AppError(409, 'callbacks.alreadyClosed')
  if (!canTransition(c.status, to)) throw new AppError(409, 'callbacks.invalidTransition')
}

async function publishTransition(actor: CallbackActor, c: CallbackRow, type: TransitionType) {
  const names: Record<TransitionType, string> = {
    dispatched: 'CallbackDispatched',
    on_site: 'CallbackOnSite',
    released: 'CallbackReleased',
    restored: 'CallbackRestored',
    closed: 'CallbackClosed',
  }
  await events.publish(actor, {
    type: names[type],
    aggregateType: 'callback',
    aggregateId: c.id,
    payload: {
      elevatorId: c.elevatorId,
      status: c.status,
      assignedUserId: c.assignedUserId,
      responseMinutes: responseMinutes(c),
    },
  })
}

export async function dispatch(
  actor: CallbackActor,
  id: string,
  body: { userId: string; at?: string },
): Promise<CallbackDto> {
  const now = clock.now()
  const at = parseAt(body.at, now, 'callbacks.timeInFuture')
  // Existence (404) before the user check (400): a foreign tenant learns nothing about our users.
  await load(actor, id)
  const [u] = await findUsersByIds(actor.tenantId, [body.userId])
  if (!u || !u.isActive) throw new AppError(400, 'callbacks.userNotFound')
  const updated = await transaction(async (tx) => {
    const c = await load(actor, id, tx)
    assertTransition(c, 'dispatched')
    const next = await repo.updateCallback(
      actor.tenantId,
      c.id,
      { status: 'dispatched', dispatchedAt: c.dispatchedAt ?? at, assignedUserId: u.id },
      tx,
    )
    await repo.appendEvent(
      actor.tenantId,
      {
        callbackId: c.id,
        type: 'dispatched',
        at,
        source: actor.source,
        byUserId: actor.userId,
        data: { userId: u.id, userName: u.name },
      },
      tx,
    )
    await audit(
      auditActor(actor),
      {
        action: 'callback.dispatch',
        entityType: 'callback',
        entityId: c.id,
        before: { status: c.status, assignedUserId: c.assignedUserId },
        after: { status: next.status, assignedUserId: next.assignedUserId },
      },
      tx,
    )
    return next
  })
  await publishTransition(actor, updated, 'dispatched')
  return toCallbackDto(updated, now, new Map([[u.id, u.name]]))
}

/** on_site / released / restored - the technician's timeline events. */
export async function transition(
  actor: CallbackActor,
  id: string,
  type: 'on_site' | 'released' | 'restored',
  body: { at?: string; notes?: string | null },
): Promise<CallbackDto> {
  const now = clock.now()
  const at = parseAt(body.at, now, 'callbacks.timeInFuture')
  const updated = await transaction(async (tx) => {
    const c = await load(actor, id, tx)
    assertTransition(c, type)
    const patch: repo.CallbackPatch = { status: type }
    if (type === 'on_site') {
      patch.onSiteAt = at
      // A technician who arrives without a dispatch picks the callback up.
      if (!c.assignedUserId && actor.role === 'technician') patch.assignedUserId = actor.userId
      if (!c.dispatchedAt) patch.dispatchedAt = at
    }
    if (type === 'released') patch.releasedAt = at
    if (type === 'restored') patch.restoredAt = at
    if (body.notes) patch.notes = c.notes ? `${c.notes}\n${body.notes}` : body.notes
    const next = await repo.updateCallback(actor.tenantId, c.id, patch, tx)
    await repo.appendEvent(
      actor.tenantId,
      {
        callbackId: c.id,
        type,
        at,
        source: actor.source,
        byUserId: actor.userId,
        data: body.notes ? { notes: body.notes } : {},
      },
      tx,
    )
    await audit(
      auditActor(actor),
      {
        action: `callback.${type}`,
        entityType: 'callback',
        entityId: c.id,
        before: { status: c.status },
        after: { status: next.status, at },
      },
      tx,
    )
    return next
  })
  await publishTransition(actor, updated, type)
  return toCallbackDto(updated, now, await namesFor(actor.tenantId, [updated.assignedUserId]))
}

/**
 * Close-out: cause, action taken, chargeable flag. Also records the visit (kind=callback) through
 * the VisitRecorder port so it shows in the elevator's history; the visit id is stored on the
 * callback. The visit is written after the close commits - a failure there is logged and leaves
 * closeoutVisitId null (visible in the UI), it never un-closes the callback.
 */
export async function close(
  ctx: Ctx,
  actor: CallbackActor,
  id: string,
  body: CloseCallbackBody,
): Promise<CallbackDto> {
  const now = clock.now()
  const at = parseAt(body.at, now, 'callbacks.timeInFuture')
  const updated = await transaction(async (tx) => {
    const c = await load(actor, id, tx)
    assertTransition(c, 'closed')
    const next = await repo.updateCallback(
      actor.tenantId,
      c.id,
      {
        status: 'closed',
        closedAt: at,
        cause: body.cause,
        actionTaken: body.actionTaken,
        chargeable: body.chargeable,
        chargeReason: body.chargeable ? (body.chargeReason ?? 'other') : null,
        ...(body.notes !== undefined
          ? { notes: body.notes ? (c.notes ? `${c.notes}\n${body.notes}` : body.notes) : c.notes }
          : {}),
      },
      tx,
    )
    await repo.appendEvent(
      actor.tenantId,
      {
        callbackId: c.id,
        type: 'closed',
        at,
        source: actor.source,
        byUserId: actor.userId,
        data: { cause: body.cause, actionTaken: body.actionTaken, chargeable: body.chargeable },
      },
      tx,
    )
    await audit(
      auditActor(actor),
      {
        action: 'callback.close',
        entityType: 'callback',
        entityId: c.id,
        before: { status: c.status },
        after: { status: 'closed', chargeable: body.chargeable, cause: body.cause },
      },
      tx,
    )
    return next
  })
  await publishTransition(actor, updated, 'closed')

  let final = updated
  const recorder = visitRecorder()
  if (body.createVisit && recorder) {
    try {
      const technicianId = updated.assignedUserId ?? ctx.userId
      const visit = await recorder.record(ctx, {
        elevatorId: updated.elevatorId,
        kind: 'callback',
        startedAt: (updated.onSiteAt ?? updated.receivedAt).toISOString(),
        endedAt: at.toISOString(),
        technicians: [{ userId: technicianId }],
        notes: `${body.cause} — ${body.actionTaken}`,
        source: actor.source === 'app' ? 'app' : 'office',
      })
      final = await repo.updateCallback(actor.tenantId, updated.id, { closeoutVisitId: visit.id })
    } catch (err) {
      logger.error({ err, callbackId: updated.id }, 'close-out visit not recorded')
    }
  }
  return toCallbackDto(final, now, await namesFor(actor.tenantId, [final.assignedUserId]))
}

// ---- reads ---------------------------------------------------------------------------------

export async function get(ctx: Ctx, id: string): Promise<CallbackDetailDto> {
  const c = await repo.findCallbackDetail(ctx.tenantId, id)
  if (!c) throw notFound()
  if (ctx.role === 'technician' && c.assignedUserId && c.assignedUserId !== ctx.userId)
    throw notFound()
  const names = await namesFor(ctx.tenantId, [
    c.assignedUserId,
    c.createdByUserId,
    ...c.events.map((e) => e.byUserId),
  ])
  const now = clock.now()
  return { ...toCallbackDto(c, now, names), events: c.events.map((e) => toEventDto(e, names)) }
}

export async function list(ctx: Ctx, q: CallbackListQuery): Promise<Page<CallbackDto>> {
  const rows = await repo.listCallbacks(ctx.tenantId, {
    cursor: q.cursor,
    limit: q.limit,
    status: q.status,
    open: q.open,
    elevatorId: q.elevatorId,
    buildingId: q.buildingId,
    assignedUserId: q.assignedUserId,
    visibleToUserId: ctx.role === 'technician' ? ctx.userId : undefined,
    from: fromDateOnly(q.from) ?? undefined,
    to: q.to ? fromDateOnly(addDays(q.to, 1))! : undefined,
  })
  return page(ctx.tenantId, rows, q.limit)
}

export async function listForElevator(
  ctx: Ctx,
  elevatorId: string,
  q: { cursor?: string; limit: number },
): Promise<Page<CallbackDto>> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  const rows = await repo.listCallbacks(ctx.tenantId, {
    ...q,
    elevatorId,
    visibleToUserId: ctx.role === 'technician' ? ctx.userId : undefined,
  })
  return page(ctx.tenantId, rows, q.limit)
}

async function page(tenantId: string, rows: CallbackRow[], limit: number) {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const names = await namesFor(
    tenantId,
    items.map((c) => c.assignedUserId),
  )
  const now = clock.now()
  return {
    items: items.map((c) => toCallbackDto(c, now, names)),
    nextCursor: hasMore ? repo.cursorOf(items[items.length - 1]!) : null,
  }
}

/** Dashboard widget: open count, SLA states, the oldest open callback with its timer. */
export async function openSummary(tenantId: string): Promise<CallbacksSummaryDto> {
  const rows = await repo.listOpen(tenantId)
  const now = clock.now()
  const out: CallbacksSummaryDto = { open: 0, breached: 0, atRisk: 0, trapped: 0, oldest: null }
  for (const c of rows) {
    out.open++
    const s = slaState(c, now)
    if (s === 'breached') out.breached++
    if (s === 'at_risk') out.atRisk++
    if (c.classification === 'trapped_persons' && !c.releasedAt) out.trapped++
  }
  const oldest = rows[0]
  if (oldest)
    out.oldest = toCallbackDto(oldest, now, await namesFor(tenantId, [oldest.assignedUserId]))
  return out
}

/** Open callbacks per elevator (map pins) and the ones already over their limit (calendar). */
export async function openByElevator(tenantId: string): Promise<Map<string, CallbackRow[]>> {
  const rows = await repo.listOpen(tenantId)
  const map = new Map<string, CallbackRow[]>()
  for (const c of rows) {
    const arr = map.get(c.elevatorId) ?? []
    arr.push(c)
    map.set(c.elevatorId, arr)
  }
  return map
}

export async function openOverSla(tenantId: string): Promise<CallbackRow[]> {
  const now = clock.now()
  return (await repo.listOpen(tenantId)).filter((c) => slaState(c, now) === 'breached')
}
