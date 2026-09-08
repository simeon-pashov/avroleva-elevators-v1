import type {
  CreateDefectBody,
  DefectCatalogItemDto,
  DefectDto,
  DefectListQuery,
  DefectsSummaryDto,
  Page,
  UpdateDefectBody,
} from '@avroleva/contracts'
import { defectCatalog, defectCatalogItem } from '@avroleva/domain-data'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { clock, fromDateOnly, toDateOnly, todayInSofia } from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { transaction } from '../../platform/db/prisma.js'
import type { Tx } from '../../platform/db/prisma.js'
import { getTenantSettings } from '../tenancy/index.js'
import { elevators } from '../registry/index.js'
import * as repo from './repo/defects.js'
import type { DefectRow } from './repo/defects.js'
import { canChangeStatus, followUpDueAt } from './domain/followUp.js'

const MAX_FUTURE_MS = 60 * 60 * 1000

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

export function toDefectDto(d: DefectRow, today: string = todayInSofia()): DefectDto {
  const followUp = toDateOnly(d.followUpDueAt)!
  return {
    id: d.id,
    elevatorId: d.elevatorId,
    elevatorInternalNo: d.elevator.internalNo,
    buildingId: d.buildingId,
    buildingAddressText: d.building.addressText,
    catalogCode: d.catalogCode,
    catalogRef: defectCatalogItem(d.catalogCode)?.ref ?? null,
    description: d.description,
    severity: d.severity,
    stopLift: d.stopLift,
    status: d.status,
    recordedAt: d.recordedAt.toISOString(),
    sourceType: d.sourceType,
    sourceId: d.sourceId,
    noticeSentAt: d.noticeSentAt ? d.noticeSentAt.toISOString() : null,
    customerRequestedAt: d.customerRequestedAt ? d.customerRequestedAt.toISOString() : null,
    followUpDueAt: followUp,
    followUpInDays: daysBetween(today, followUp),
    resolvedAt: d.resolvedAt ? d.resolvedAt.toISOString() : null,
    resolvedVisitId: d.resolvedVisitId,
    notes: d.notes,
    createdByUserId: d.createdByUserId,
    createdAt: d.createdAt.toISOString(),
  }
}

/** The seeded catalogue in the caller's language (office picker, technician app). */
export function catalog(locale: string): DefectCatalogItemDto[] {
  return defectCatalog.items.map((i) => ({
    code: i.code,
    label: locale === 'en' ? i.en : i.bg,
    stopLift: i.stopLift,
    ref: i.ref,
  }))
}

/**
 * Records a defect. A catalogue code fills the description and the stop-lift flag; a stop-lift
 * defect on an active elevator sets `stopped_by_firm` through the registry command (same
 * transaction, audit entry, ElevatorStatusChanged). Emits DefectRecorded (+ StopLiftRequired).
 */
export async function record(ctx: Ctx, body: CreateDefectBody): Promise<DefectDto> {
  if (body.id) {
    const existing = await repo.findDefect(ctx.tenantId, body.id)
    if (existing) return toDefectDto(existing)
  }
  const elevator = await elevators.find(ctx.tenantId, body.elevatorId)
  if (!elevator) throw notFound()
  const now = clock.now()
  const recordedAt = body.recordedAt ? new Date(body.recordedAt) : now
  if (recordedAt.getTime() > now.getTime() + MAX_FUTURE_MS)
    throw new AppError(400, 'defects.recordedInFuture')
  const item = defectCatalogItem(body.catalogCode)
  const description =
    body.description ??
    (item && item.code !== 'other' ? item[ctx.locale === 'en' ? 'en' : 'bg'] : null)
  if (!description)
    throw new AppError(400, 'error.validation', {
      fields: [{ path: 'description', code: 'validation.required' }],
    })
  const stopLift = body.stopLift ?? item?.stopLift ?? false
  const settings = await getTenantSettings(ctx.tenantId)
  const created = await transaction(async (tx) => {
    const d = await repo.createDefect(
      ctx.tenantId,
      {
        id: body.id,
        elevatorId: elevator.id,
        buildingId: elevator.buildingId,
        catalogCode: item?.code ?? null,
        description,
        severity: body.severity,
        stopLift,
        recordedAt,
        sourceType: body.sourceType,
        sourceId: body.sourceId ?? null,
        followUpDueAt: fromDateOnly(followUpDueAt(recordedAt, settings.defectFollowUpDays))!,
        notes: body.notes ?? null,
        createdByUserId: ctx.userId,
      },
      tx,
    )
    await audit(
      actorOf(ctx),
      {
        action: 'defect.record',
        entityType: 'defect',
        entityId: d.id,
        after: { elevatorId: d.elevatorId, catalogCode: d.catalogCode, stopLift: d.stopLift },
      },
      tx,
    )
    if (stopLift && elevator.status === 'active') {
      await elevators.setStatus(ctx, elevator.id, 'stopped_by_firm', stopReason(d), tx)
    }
    return d
  })
  await events.publish(ctx, {
    type: 'DefectRecorded',
    aggregateType: 'defect',
    aggregateId: created.id,
    payload: {
      elevatorId: created.elevatorId,
      catalogCode: created.catalogCode,
      stopLift: created.stopLift,
      sourceType: created.sourceType,
    },
  })
  if (stopLift)
    await events.publish(ctx, {
      type: 'StopLiftRequired',
      aggregateType: 'defect',
      aggregateId: created.id,
      payload: { elevatorId: created.elevatorId, catalogCode: created.catalogCode },
    })
  return toDefectDto(created)
}

function stopReason(d: DefectRow): string {
  const ref = defectCatalogItem(d.catalogCode)?.ref
  return ref ? `${ref}: ${d.description}` : d.description
}

/**
 * Status transitions and date stamps: notified (noticeSentAt), awaiting_approval
 * (customerRequestedAt), scheduled, resolved (resolvedAt; restores the elevator to active when no
 * other open stop-lift defect remains and the firm itself had stopped it).
 */
export async function update(ctx: Ctx, id: string, body: UpdateDefectBody): Promise<DefectDto> {
  const now = clock.now()
  const updated = await transaction(async (tx) => {
    const before = await repo.findDefect(ctx.tenantId, id, tx)
    if (!before) throw notFound()
    const to = body.status ?? before.status
    if (body.status && body.status !== before.status && !canChangeStatus(before.status, to))
      throw new AppError(409, 'defects.invalidTransition')
    if (before.status === 'resolved' && body.status && body.status !== 'resolved')
      throw new AppError(409, 'defects.alreadyResolved')
    const data: Parameters<typeof repo.updateDefect>[2] = {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.severity !== undefined ? { severity: body.severity } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.noticeSentAt !== undefined
        ? { noticeSentAt: body.noticeSentAt ? new Date(body.noticeSentAt) : null }
        : {}),
      ...(body.customerRequestedAt !== undefined
        ? {
            customerRequestedAt: body.customerRequestedAt
              ? new Date(body.customerRequestedAt)
              : null,
          }
        : {}),
      ...(body.resolvedVisitId !== undefined ? { resolvedVisitId: body.resolvedVisitId } : {}),
    }
    if (to === 'notified' && !before.noticeSentAt && body.noticeSentAt === undefined)
      data.noticeSentAt = now
    if (
      to === 'awaiting_approval' &&
      !before.customerRequestedAt &&
      body.customerRequestedAt === undefined
    )
      data.customerRequestedAt = now
    if (to === 'resolved' && before.status !== 'resolved')
      data.resolvedAt = body.resolvedAt ? new Date(body.resolvedAt) : now
    const d = await repo.updateDefect(ctx.tenantId, id, data, tx)
    await audit(
      actorOf(ctx),
      {
        action: 'defect.update',
        entityType: 'defect',
        entityId: id,
        before: { status: before.status },
        after: { status: d.status, noticeSentAt: d.noticeSentAt, resolvedAt: d.resolvedAt },
      },
      tx,
    )
    if (d.status === 'resolved' && before.status !== 'resolved' && d.stopLift) {
      await restoreIfClear(ctx, d.elevatorId, tx)
    }
    return { before, d }
  })
  if (updated.d.status === 'resolved' && updated.before.status !== 'resolved')
    await events.publish(ctx, {
      type: 'DefectResolved',
      aggregateType: 'defect',
      aggregateId: id,
      payload: { elevatorId: updated.d.elevatorId, stopLift: updated.d.stopLift },
    })
  return toDefectDto(updated.d)
}

/** Restores `active` when the firm stopped the lift and no open stop-lift defect remains. */
async function restoreIfClear(ctx: Ctx, elevatorId: string, tx: Tx) {
  const remaining = await repo.countOpenStopLift(ctx.tenantId, elevatorId, tx)
  if (remaining > 0) return
  const e = await elevators.find(ctx.tenantId, elevatorId, tx)
  if (e?.status === 'stopped_by_firm')
    await elevators.setStatus(ctx, elevatorId, 'active', null, tx)
}

export async function get(ctx: Ctx, id: string): Promise<DefectDto> {
  const d = await repo.findDefect(ctx.tenantId, id)
  if (!d) throw notFound()
  return toDefectDto(d)
}

export async function list(ctx: Ctx, q: DefectListQuery): Promise<Page<DefectDto>> {
  const rows = await repo.listDefects(ctx.tenantId, {
    cursor: q.cursor,
    limit: q.limit,
    status: q.status,
    open: q.open,
    elevatorId: q.elevatorId,
    buildingId: q.buildingId,
    stopLift: q.stopLift,
    followUpDueBy: q.followUpDue ? fromDateOnly(q.to ?? todayInSofia())! : undefined,
  })
  return page(rows, q.limit)
}

export async function listForElevator(
  ctx: Ctx,
  elevatorId: string,
  q: { cursor?: string; limit: number },
): Promise<Page<DefectDto>> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  return page(await repo.listDefects(ctx.tenantId, { ...q, elevatorId }), q.limit)
}

function page(rows: DefectRow[], limit: number): Page<DefectDto> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const today = todayInSofia()
  return {
    items: items.map((d) => toDefectDto(d, today)),
    nextCursor: hasMore ? repo.cursorOf(items[items.length - 1]!) : null,
  }
}

/** Dashboard counts and the set of elevators with an open stop-lift defect (map pins). */
export async function openSummary(
  tenantId: string,
): Promise<DefectsSummaryDto & { stopLiftElevatorIds: Set<string> }> {
  const rows = await repo.listOpen(tenantId)
  const today = todayInSofia()
  const out = {
    open: 0,
    stopLift: 0,
    awaitingApproval: 0,
    followUpDue: 0,
    stopLiftElevatorIds: new Set<string>(),
  }
  for (const d of rows) {
    out.open++
    if (d.stopLift) {
      out.stopLift++
      out.stopLiftElevatorIds.add(d.elevatorId)
    }
    if (d.status === 'awaiting_approval') out.awaitingApproval++
    if (toDateOnly(d.followUpDueAt)! <= today) out.followUpDue++
  }
  return out
}

/** Sync pull for the technician app: open + changed since the watermark. */
export async function listForSync(ctx: Ctx, since: Date | null): Promise<DefectDto[]> {
  const today = todayInSofia()
  return (await repo.listForSync(ctx.tenantId, since, 500)).map((d) => toDefectDto(d, today))
}

/** Open defects for the calendar (follow-up dates). */
export function listOpenRows(tenantId: string): Promise<DefectRow[]> {
  return repo.listOpen(tenantId)
}
