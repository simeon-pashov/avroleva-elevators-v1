import type {
  AmendVisitBody,
  CreateVisitBody,
  Page,
  VisitDto,
  VisitListQuery,
} from '@avroleva/contracts'
import { CHECK_VISIT_KINDS } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { clock, dateOnlyInSofia, fromDateOnly, addDays } from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { transaction } from '../../platform/db/prisma.js'
import type { Tx } from '../../platform/db/prisma.js'
import { findUsersByIds } from '../tenancy/index.js'
import { elevators } from '../registry/index.js'
import * as repo from './repo/visits.js'
import type { VisitRow } from './repo/visits.js'

const MAX_FUTURE_MS = 60 * 60 * 1000

export function toVisitDto(v: VisitRow): VisitDto {
  return {
    id: v.id,
    elevatorId: v.elevatorId,
    ...(v.elevator ? { elevatorInternalNo: v.elevator.internalNo } : {}),
    buildingId: v.buildingId,
    ...(v.building ? { buildingAddressText: v.building.addressText } : {}),
    kind: v.kind,
    startedAt: v.startedAt.toISOString(),
    endedAt: v.endedAt ? v.endedAt.toISOString() : null,
    technicians: v.technicians.map((t) => ({ userId: t.userId, name: t.name })),
    notes: v.notes,
    source: v.source,
    qualityFlags: (v.qualityFlags as string[]) ?? [],
    createdByUserId: v.createdByUserId,
    supersedesVisitId: v.supersedesVisitId,
    supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  }
}

/** Resolves technician user ids to name snapshots; free-text names are kept as written. */
async function resolveTechnicians(
  tenantId: string,
  input: CreateVisitBody['technicians'],
): Promise<Array<{ userId: string | null; name: string }>> {
  const ids = input.map((t) => t.userId).filter((x): x is string => !!x)
  const users = await findUsersByIds(tenantId, ids)
  const byId = new Map(users.map((u) => [u.id, u]))
  const out: Array<{ userId: string | null; name: string }> = []
  for (const t of input) {
    if (t.userId) {
      const u = byId.get(t.userId)
      if (!u) throw notFound()
      out.push({ userId: u.id, name: t.name ?? u.name })
    } else {
      out.push({ userId: null, name: t.name! })
    }
  }
  return out
}

function qualityFlags(body: {
  startedAt: string
  endedAt?: string | null
  technicians: unknown[]
}) {
  const flags: string[] = []
  if (body.technicians.length < 2) flags.push('singleTechnician')
  if (body.endedAt && Date.parse(body.endedAt) < Date.parse(body.startedAt))
    flags.push('endBeforeStart')
  return flags
}

/**
 * Records a visit (office / paper entry). Idempotent on a client-provided id: a second POST with
 * the same id returns the stored visit. A check visit moves elevator.lastCheckAt through the
 * registry command (same transaction) and clears any "move to tomorrow" override.
 */
export async function record(ctx: Ctx, body: CreateVisitBody): Promise<VisitDto> {
  if (body.id) {
    const existing = await repo.findVisit(ctx.tenantId, body.id)
    if (existing) return toVisitDto(existing)
  }
  const elevator = await elevators.find(ctx.tenantId, body.elevatorId)
  if (!elevator) throw notFound()
  const startedAt = new Date(body.startedAt)
  if (startedAt.getTime() > clock.now().getTime() + MAX_FUTURE_MS)
    throw new AppError(400, 'visits.inFuture')
  const technicians = await resolveTechnicians(ctx.tenantId, body.technicians)
  const created = await transaction(async (tx) => {
    const v = await repo.createVisit(
      ctx.tenantId,
      {
        id: body.id,
        elevatorId: elevator.id,
        buildingId: elevator.buildingId,
        kind: body.kind,
        startedAt,
        endedAt: body.endedAt ? new Date(body.endedAt) : null,
        notes: body.notes ?? null,
        source: body.source,
        qualityFlags: qualityFlags(body),
        createdByUserId: ctx.userId,
        technicians,
      },
      tx,
    )
    await applyCheck(ctx.tenantId, v, tx)
    await audit(
      actorOf(ctx),
      {
        action: 'visit.record',
        entityType: 'visit',
        entityId: v.id,
        after: { elevatorId: v.elevatorId, kind: v.kind, startedAt: v.startedAt },
      },
      tx,
    )
    return v
  })
  await publishRecorded(ctx, created)
  return toVisitDto(created)
}

/**
 * Visits are append-only (ARCHITECTURE section 3): an amendment creates a new visit that
 * supersedes the original; the original stays readable with `supersededAt` set.
 */
export async function amend(ctx: Ctx, id: string, body: AmendVisitBody): Promise<VisitDto> {
  const original = await repo.findVisit(ctx.tenantId, id)
  if (!original) throw notFound()
  if (original.supersededAt) throw new AppError(409, 'visits.alreadySuperseded')
  const merged = {
    kind: body.kind ?? original.kind,
    startedAt: body.startedAt ?? original.startedAt.toISOString(),
    endedAt:
      body.endedAt !== undefined
        ? body.endedAt
        : original.endedAt
          ? original.endedAt.toISOString()
          : null,
    notes: body.notes !== undefined ? body.notes : original.notes,
    source: body.source ?? original.source,
    technicians:
      body.technicians ?? original.technicians.map((t) => ({ userId: t.userId, name: t.name })),
  }
  const technicians = await resolveTechnicians(ctx.tenantId, merged.technicians)
  const created = await transaction(async (tx) => {
    const now = clock.now()
    await repo.markSuperseded(ctx.tenantId, original.id, now, tx)
    const v = await repo.createVisit(
      ctx.tenantId,
      {
        elevatorId: original.elevatorId,
        buildingId: original.buildingId,
        kind: merged.kind,
        startedAt: new Date(merged.startedAt),
        endedAt: merged.endedAt ? new Date(merged.endedAt) : null,
        notes: merged.notes ?? null,
        source: merged.source,
        qualityFlags: qualityFlags({ ...merged, technicians }),
        createdByUserId: ctx.userId,
        supersedesVisitId: original.id,
        technicians,
      },
      tx,
    )
    await applyCheck(ctx.tenantId, v, tx)
    await audit(
      actorOf(ctx),
      {
        action: 'visit.amend',
        entityType: 'visit',
        entityId: v.id,
        before: { supersedes: original.id, startedAt: original.startedAt, kind: original.kind },
        after: { startedAt: v.startedAt, kind: v.kind },
      },
      tx,
    )
    return v
  })
  await events.publish(ctx, {
    type: 'VisitAmended',
    aggregateType: 'visit',
    aggregateId: created.id,
    payload: { supersedes: original.id, elevatorId: created.elevatorId },
  })
  return toVisitDto(created)
}

export async function get(ctx: Ctx, id: string): Promise<VisitDto> {
  const v = await repo.findVisit(ctx.tenantId, id)
  if (!v) throw notFound()
  return toVisitDto(v)
}

export async function listForElevator(
  ctx: Ctx,
  elevatorId: string,
  q: { cursor?: string; limit: number },
): Promise<Page<VisitDto>> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  return page(await repo.listVisits(ctx.tenantId, { ...q, elevatorId }), q.limit)
}

export async function list(ctx: Ctx, q: VisitListQuery): Promise<Page<VisitDto>> {
  const rows = await repo.listVisits(ctx.tenantId, {
    cursor: q.cursor,
    limit: q.limit,
    elevatorId: q.elevatorId,
    buildingId: q.buildingId,
    kind: q.kind,
    from: fromDateOnly(q.from) ?? undefined,
    to: q.to ? fromDateOnly(addDays(q.to, 1))! : undefined,
  })
  return page(rows, q.limit)
}

function page(rows: VisitRow[], limit: number): Page<VisitDto> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return {
    items: items.map(toVisitDto),
    nextCursor: hasMore ? repo.cursorOf(items[items.length - 1]!) : null,
  }
}

async function applyCheck(tenantId: string, v: VisitRow, tx: Tx) {
  if (!CHECK_VISIT_KINDS.includes(v.kind)) return
  await elevators.recordCheck(tenantId, v.elevatorId, dateOnlyInSofia(v.startedAt), tx)
}

async function publishRecorded(ctx: Ctx, v: VisitRow) {
  await events.publish(ctx, {
    type: 'VisitRecorded',
    aggregateType: 'visit',
    aggregateId: v.id,
    payload: {
      elevatorId: v.elevatorId,
      buildingId: v.buildingId,
      kind: v.kind,
      startedAt: v.startedAt.toISOString(),
      source: v.source,
    },
  })
}
