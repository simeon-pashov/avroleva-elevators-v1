import type {
  AmendVisitBody,
  ChecklistSnapshotDto,
  CreateVisitBody,
  GpsPoint,
  Page,
  TenantSettings,
  VisitAttachmentDto,
  VisitDto,
  VisitListQuery,
} from '@avroleva/contracts'
import { CHECK_VISIT_KINDS, summarizeChecklist } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import {
  clock,
  clockSuspect,
  dateOnlyInSofia,
  fromDateOnly,
  addDays,
} from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { transaction } from '../../platform/db/prisma.js'
import type { Tx } from '../../platform/db/prisma.js'
import { findUsersByIds, getTenantSettings } from '../tenancy/index.js'
import { elevators } from '../registry/index.js'
import * as documents from '../documents/index.js'
import * as repo from './repo/visits.js'
import type { VisitRow } from './repo/visits.js'
import { checklistResolver } from './domain/ports.js'

const MAX_FUTURE_MS = 60 * 60 * 1000

export function toVisitDto(v: VisitRow, attachments: VisitAttachmentDto[] = []): VisitDto {
  const stored = (v.checklist as ChecklistSnapshotDto | null) ?? null
  const checklist: ChecklistSnapshotDto | null =
    stored && v.templateKey
      ? {
          templateKey: v.templateKey,
          templateVersion: v.templateVersion ?? 1,
          items: stored.items ?? [],
          summary: stored.summary ?? summarizeChecklist(stored.items ?? []),
        }
      : null
  const flags = [...((v.qualityFlags as string[]) ?? [])]
  if (attachments.some((a) => !a.uploaded)) flags.push('pendingUploads')
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
    timestampSource: v.timestampSource,
    clientOffsetMs: v.clientOffsetMs,
    receivedAt: v.createdAt.toISOString(),
    qualityFlags: flags,
    checklist,
    attachments,
    gps: (v.gps as GpsPoint | null) ?? null,
    createdByUserId: v.createdByUserId,
    supersedesVisitId: v.supersedesVisitId,
    supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
    photosPurgedAt: v.photosPurgedAt ? v.photosPurgedAt.toISOString() : null,
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

/**
 * Quality flags (never a rejection - the record shows what happened, A12/A13):
 * singleTechnician when fewer than `settings.minTechnicians[kind]`, endBeforeStart,
 * clockSuspect when the phone's offset is > 2 min or the timestamp is > 5 min ahead of the server.
 */
export function qualityFlags(
  v: {
    kind: CreateVisitBody['kind']
    startedAt: Date
    endedAt: Date | null
    technicians: unknown[]
    clientOffsetMs: number
    timestampSource: string
  },
  settings: Pick<TenantSettings, 'minTechnicians'>,
  now: Date,
): string[] {
  const flags: string[] = []
  const min = settings.minTechnicians[v.kind] ?? 1
  if (v.technicians.length < min) flags.push('singleTechnician')
  if (v.endedAt && v.endedAt.getTime() < v.startedAt.getTime()) flags.push('endBeforeStart')
  if (
    v.timestampSource === 'device' &&
    clockSuspect(v.endedAt ?? v.startedAt, now, v.clientOffsetMs)
  )
    flags.push('clockSuspect')
  return flags
}

/**
 * Records a visit (office, paper entry, technician app). Idempotent on a client-provided id: a
 * second POST with the same id returns the stored visit. A check visit moves elevator.lastCheckAt
 * through the registry command (same transaction) and clears any "move to tomorrow" override.
 * The checklist answers are snapshotted with their labels; attachment links are written before
 * the photos exist (parent before child).
 */
export async function record(ctx: Ctx, body: CreateVisitBody): Promise<VisitDto> {
  if (body.id) {
    const existing = await repo.findVisit(ctx.tenantId, body.id)
    if (existing) return withAttachments(ctx.tenantId, existing)
  }
  const elevator = await elevators.find(ctx.tenantId, body.elevatorId)
  if (!elevator) throw notFound()
  const now = clock.now()
  const startedAt = new Date(body.startedAt)
  if (startedAt.getTime() > now.getTime() + MAX_FUTURE_MS)
    throw new AppError(400, 'visits.inFuture')
  const endedAt = body.endedAt ? new Date(body.endedAt) : null
  const technicians = await resolveTechnicians(ctx.tenantId, body.technicians)
  const settings = await getTenantSettings(ctx.tenantId)
  const created = await transaction(async (tx) => {
    const checklist = body.checklist
      ? await checklistResolver().snapshotFor(ctx.tenantId, body.checklist, elevator, tx)
      : null
    const v = await repo.createVisit(
      ctx.tenantId,
      {
        id: body.id,
        elevatorId: elevator.id,
        buildingId: elevator.buildingId,
        kind: body.kind,
        startedAt,
        endedAt,
        notes: body.notes ?? null,
        source: body.source,
        timestampSource: body.timestampSource,
        clientOffsetMs: body.clientOffsetMs,
        templateKey: checklist?.templateKey ?? null,
        templateVersion: checklist?.templateVersion ?? null,
        checklist,
        gps: body.gps ?? null,
        qualityFlags: qualityFlags(
          {
            kind: body.kind,
            startedAt,
            endedAt,
            technicians,
            clientOffsetMs: body.clientOffsetMs,
            timestampSource: body.timestampSource,
          },
          settings,
          now,
        ),
        createdByUserId: ctx.userId,
        technicians,
      },
      tx,
    )
    if (body.attachments.length)
      await documents.linkToVisit(
        ctx.tenantId,
        v.id,
        body.attachments.map((a) => ({ attachmentId: a.id, role: a.role })),
        tx,
      )
    await applyCheck(ctx.tenantId, v, tx)
    await audit(
      actorOf(ctx),
      {
        action: 'visit.record',
        entityType: 'visit',
        entityId: v.id,
        after: {
          elevatorId: v.elevatorId,
          kind: v.kind,
          startedAt: v.startedAt,
          source: v.source,
          qualityFlags: v.qualityFlags,
        },
      },
      tx,
    )
    return v
  })
  await publishRecorded(ctx, created)
  return withAttachments(ctx.tenantId, created)
}

/**
 * Visits are append-only (ARCHITECTURE section 3): an amendment creates a new visit that
 * supersedes the original; the original stays readable with `supersededAt` set. Checklist and
 * attachments carry over unless the amendment replaces them.
 */
export async function amend(ctx: Ctx, id: string, body: AmendVisitBody): Promise<VisitDto> {
  const original = await repo.findVisit(ctx.tenantId, id)
  if (!original) throw notFound()
  if (original.supersededAt) throw new AppError(409, 'visits.alreadySuperseded')
  const elevator = await elevators.find(ctx.tenantId, original.elevatorId)
  if (!elevator) throw notFound()
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
    timestampSource: body.timestampSource ?? original.timestampSource,
    clientOffsetMs: body.clientOffsetMs ?? original.clientOffsetMs,
    gps: body.gps !== undefined ? body.gps : (original.gps as GpsPoint | null),
  }
  const technicians = await resolveTechnicians(ctx.tenantId, merged.technicians)
  const settings = await getTenantSettings(ctx.tenantId)
  const now = clock.now()
  const startedAt = new Date(merged.startedAt)
  const endedAt = merged.endedAt ? new Date(merged.endedAt) : null
  const originalLinks = (await documents.attachmentsForVisits(ctx.tenantId, [original.id])).get(
    original.id,
  )
  const created = await transaction(async (tx) => {
    const checklist =
      body.checklist !== undefined
        ? body.checklist
          ? await checklistResolver().snapshotFor(ctx.tenantId, body.checklist, elevator, tx)
          : null
        : ((original.checklist as ChecklistSnapshotDto | null) ?? null)
    await repo.markSuperseded(ctx.tenantId, original.id, now, tx)
    const v = await repo.createVisit(
      ctx.tenantId,
      {
        elevatorId: original.elevatorId,
        buildingId: original.buildingId,
        kind: merged.kind,
        startedAt,
        endedAt,
        notes: merged.notes ?? null,
        source: merged.source,
        timestampSource: merged.timestampSource,
        clientOffsetMs: merged.clientOffsetMs,
        templateKey: checklist?.templateKey ?? null,
        templateVersion: checklist?.templateVersion ?? null,
        checklist,
        gps: merged.gps ?? null,
        qualityFlags: qualityFlags(
          {
            kind: merged.kind,
            startedAt,
            endedAt,
            technicians,
            clientOffsetMs: merged.clientOffsetMs,
            timestampSource: merged.timestampSource,
          },
          settings,
          now,
        ),
        createdByUserId: ctx.userId,
        supersedesVisitId: original.id,
        technicians,
      },
      tx,
    )
    const links =
      body.attachments !== undefined
        ? body.attachments.map((a) => ({ attachmentId: a.id, role: a.role }))
        : (originalLinks ?? []).map((a) => ({ attachmentId: a.attachmentId, role: a.role }))
    if (links.length) await documents.linkToVisit(ctx.tenantId, v.id, links, tx)
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
  return withAttachments(ctx.tenantId, created)
}

export async function get(ctx: Ctx, id: string): Promise<VisitDto> {
  const v = await repo.findVisit(ctx.tenantId, id)
  if (!v) throw notFound()
  return withAttachments(ctx.tenantId, v)
}

export async function listForElevator(
  ctx: Ctx,
  elevatorId: string,
  q: { cursor?: string; limit: number },
): Promise<Page<VisitDto>> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  return page(ctx.tenantId, await repo.listVisits(ctx.tenantId, { ...q, elevatorId }), q.limit)
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
  return page(ctx.tenantId, rows, q.limit)
}

/** Sync pull: visits received since a watermark (server clock), newest first, capped. */
export async function listSince(tenantId: string, since: Date, limit = 500): Promise<VisitDto[]> {
  return toDtos(tenantId, await repo.listReceivedSince(tenantId, since, limit))
}

async function withAttachments(tenantId: string, v: VisitRow): Promise<VisitDto> {
  const [dto] = await toDtos(tenantId, [v])
  return dto!
}

export async function toDtos(tenantId: string, rows: VisitRow[]): Promise<VisitDto[]> {
  const attachments = await documents.attachmentsForVisits(
    tenantId,
    rows.map((r) => r.id),
  )
  return rows.map((r) => toVisitDto(r, attachments.get(r.id) ?? []))
}

async function page(tenantId: string, rows: VisitRow[], limit: number): Promise<Page<VisitDto>> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return {
    items: await toDtos(tenantId, items),
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
      qualityFlags: v.qualityFlags,
    },
  })
}

/** Public facade: date of the last visit of any kind, or null. */
export async function latestVisitAt(tenantId: string, elevatorId: string): Promise<Date | null> {
  const v = await repo.latestVisit(tenantId, elevatorId)
  return v?.startedAt ?? null
}

// ---- Retention (documents.retentionSweep job) ----------------------------------------------

/** Ids of visits started before `cutoff` whose photos were not purged yet (oldest first). */
export function listForRetention(tenantId: string, cutoff: Date, limit = 500): Promise<string[]> {
  return repo.listIdsBefore(tenantId, cutoff, limit)
}

/** The retention sweep removed the photos: the visit keeps its record and gets the flag. */
export function markPhotosPurged(tenantId: string, ids: string[], at: Date): Promise<number> {
  return repo.markPhotosPurged(tenantId, ids, at)
}

/** Visits of one building in [from, to) for the monthly report (newest first, no pagination). */
export async function listForBuildingPeriod(
  tenantId: string,
  buildingId: string,
  from: Date,
  to: Date,
): Promise<VisitDto[]> {
  const rows = await repo.listVisits(tenantId, { buildingId, from, to, limit: 1000 })
  return toDtos(tenantId, rows.slice(0, 1000))
}

/** Count of visits recorded in [from, to) (dashboard "this month"). */
export function countInPeriod(tenantId: string, from: Date, to: Date): Promise<number> {
  return repo.countInPeriod(tenantId, from, to)
}
