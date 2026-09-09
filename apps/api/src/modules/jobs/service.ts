import type {
  ApprovalEvidenceDto,
  CompleteJobBody,
  CreateJobBody,
  EventSource,
  InvoiceJobBody,
  InvoiceLineDto,
  JobDetailDto,
  JobDto,
  JobEventDto,
  JobLineDto,
  JobLineInput,
  JobListQuery,
  JobNoteBody,
  JobReasonBody,
  JobStageDto,
  JobTransitionBody,
  JobsConfigDto,
  JobsSummaryDto,
  Page,
  SaveJobStagesBody,
  ScheduleJobBody,
  SendQuoteBody,
  SendQuoteResultDto,
  StartJobBody,
  UpdateJobBody,
  UpdateJobLineBody,
} from '@avroleva/contracts'
import {
  ApprovalEvidenceKind,
  JOB_EDITABLE_STAGES,
  JobKind,
  JobLineKind,
  JobOriginType,
} from '@avroleva/contracts'
import { formatDate } from '@avroleva/i18n'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf, systemActorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import {
  addDays,
  clock,
  clockSuspect,
  fromDateOnly,
  toDateOnly,
  todayInSofia,
} from '../../platform/clock.js'
import { config } from '../../platform/config.js'
import { events } from '../../platform/events/bus.js'
import { logger } from '../../platform/logger.js'
import { transaction } from '../../platform/db/prisma.js'
import type { Tx } from '../../platform/db/prisma.js'
import { findUsersByIds, getTenant, getTenantSettings } from '../tenancy/index.js'
import { buildings, customers, elevators } from '../registry/index.js'
import * as repo from './repo/jobs.js'
import type { JobDetailRow, JobEventRow, JobLineRow, JobRow } from './repo/jobs.js'
import * as stagesRepo from './repo/stages.js'
import {
  canTransition,
  defaultStages,
  isTerminal,
  openStageCodes,
  orderStages,
  requiresEvidence,
  stageOf,
  toStageDto,
  validateStages,
} from './domain/stages.js'
import type { StageDef } from './domain/stages.js'
import {
  approvalDueAt,
  approvalOverdue,
  lineTotalCents,
  quoteTotals,
  remainingNetCents,
  summarizeJobs,
} from './domain/quote.js'
import { invoiceIssuer, quoteNotifier, visitRecorder } from './domain/ports.js'
import { renderQuoteHtml } from './domain/document.js'

const MAX_FUTURE_MS = 60 * 60 * 1000
/** Audit actor: the user, or the system when a job/seed acts without one. */
const actor = (ctx: Ctx) => (ctx.userId ? actorOf(ctx) : systemActorOf(ctx.tenantId))
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

// ---- stages as data ------------------------------------------------------------------------------

/** Seeds the system stage rows (tenantId NULL) from packages/domain-data; idempotent by code. */
export async function ensureSystemJobStages(): Promise<number> {
  let n = 0
  for (const s of defaultStages()) if (await stagesRepo.ensureSystemStage(s)) n++
  return n
}

/** The tenant's own stages when it has any, else the system rows, else the shipped defaults. */
export async function effectiveStages(
  tenantId: string,
): Promise<{ stages: StageDef[]; customised: boolean }> {
  const own = await stagesRepo.stagesOf(tenantId)
  if (own.length > 0) return { stages: own.map(stagesRepo.toDef), customised: true }
  const system = await stagesRepo.stagesOf(null)
  if (system.length > 0) return { stages: system.map(stagesRepo.toDef), customised: false }
  return { stages: defaultStages(), customised: false }
}

export async function config_(ctx: Ctx): Promise<JobsConfigDto> {
  const [settings, eff] = await Promise.all([
    getTenantSettings(ctx.tenantId),
    effectiveStages(ctx.tenantId),
  ])
  return {
    stages: eff.stages.map(toStageDto),
    stagesCustomised: eff.customised,
    kinds: JobKind.options,
    originTypes: JobOriginType.options,
    lineKinds: JobLineKind.options,
    evidenceKinds: ApprovalEvidenceKind.options,
    approvalReminderDays: settings.jobs.approvalReminderDays,
    defaultWarrantyMonths: settings.jobs.defaultWarrantyMonths,
    quoteValidDays: settings.jobs.quoteValidDays,
    vatRatePercent: settings.vatRatePercent,
  }
}
export { config_ as config }

export async function saveStages(ctx: Ctx, body: SaveJobStagesBody): Promise<JobStageDto[]> {
  const defs = orderStages(
    body.stages.map((s) => ({
      code: s.code,
      labelBg: s.bg,
      labelEn: s.en,
      isTerminal: s.isTerminal,
      allowedNext: s.allowedNext,
      requiresEvidence: s.requiresEvidence,
    })),
  )
  if (defs.length > 0) {
    const v = validateStages(defs)
    if (!v.ok) throw new AppError(400, v.code, { detail: v.detail })
  }
  await stagesRepo.replaceStages(ctx.tenantId, defs)
  await audit(actor(ctx), {
    action: 'jobs.stages.save',
    entityType: 'tenant',
    entityId: ctx.tenantId,
    after: { stages: defs.map((s) => s.code) },
  })
  return (await effectiveStages(ctx.tenantId)).stages.map(toStageDto)
}

// ---- DTOs -------------------------------------------------------------------------------------------

export function toLineDto(l: JobLineRow): JobLineDto {
  return {
    id: l.id,
    quoteVersion: l.quoteVersion,
    kind: l.kind,
    description: l.description,
    qty: l.qty,
    unitCents: l.unitCents,
    totalCents: l.totalCents,
    partRef: l.partRef,
    position: l.position,
  }
}

function toEventDto(e: JobEventRow, names: Map<string, string>): JobEventDto {
  return {
    id: e.id,
    type: e.type,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    at: e.at.toISOString(),
    receivedAt: e.receivedAt.toISOString(),
    source: e.source,
    byUserId: e.byUserId,
    byUserName: e.byUserId ? (names.get(e.byUserId) ?? null) : null,
    data: (e.data ?? {}) as Record<string, unknown>,
  }
}

function evidenceDto(v: unknown): ApprovalEvidenceDto | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  return {
    kind: String(e.kind) as ApprovalEvidenceDto['kind'],
    by: (e.by as string | null) ?? null,
    note: (e.note as string | null) ?? null,
    at: String(e.at ?? ''),
    attachmentId: (e.attachmentId as string | null) ?? null,
  }
}

export function toJobDto(
  j: JobRow,
  stages: StageDef[],
  names: Map<string, string> = new Map(),
  customerNames: Map<string, string> = new Map(),
): JobDto {
  return {
    id: j.id,
    elevatorId: j.elevatorId,
    elevatorInternalNo: j.elevator.internalNo,
    buildingId: j.buildingId,
    buildingAddressText: j.building.addressText,
    customerId: j.customerId,
    customerName: j.customerId ? (customerNames.get(j.customerId) ?? null) : null,
    kind: j.kind,
    title: j.title,
    description: j.description,
    originType: j.originType,
    originId: j.originId,
    status: j.status,
    isTerminal: isTerminal(stages, j.status),
    quoteVersion: j.quoteVersion,
    netCents: j.netCents,
    vatCents: j.vatCents,
    totalCents: j.totalCents,
    vatRatePercent: j.vatRatePercent,
    lineCount: j._count.lines,
    approvalEvidence: evidenceDto(j.approvalEvidence),
    quoteSentAt: iso(j.quoteSentAt),
    quoteValidUntil: toDateOnly(j.quoteValidUntil),
    approvedAt: iso(j.approvedAt),
    scheduledAt: iso(j.scheduledAt),
    assignedUserIds: j.assignedUserIds,
    assignedUserNames: j.assignedUserIds.map((id) => names.get(id) ?? '').filter(Boolean),
    startedAt: iso(j.startedAt),
    completedAt: iso(j.completedAt),
    visitId: j.visitId,
    invoiceId: j.invoiceId,
    invoicedCents: j.invoicedCents,
    warrantyUntil: toDateOnly(j.warrantyUntil),
    rejectedReason: j.rejectedReason,
    cancelledReason: j.cancelledReason,
    notes: j.notes,
    createdByUserId: j.createdByUserId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  }
}

async function namesFor(tenantId: string, ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (unique.length === 0) return new Map<string, string>()
  const users = await findUsersByIds(tenantId, unique)
  return new Map(users.map((u) => [u.id, u.name]))
}

async function customerNamesFor(ctx: Ctx, ids: Array<string | null>) {
  const out = new Map<string, string>()
  for (const id of new Set(ids.filter((x): x is string => !!x))) {
    const c = await customers.get(ctx, id).catch(() => null)
    if (c) out.set(id, c.name)
  }
  return out
}

async function dtos(ctx: Ctx, rows: JobRow[], stages?: StageDef[]): Promise<JobDto[]> {
  const st = stages ?? (await effectiveStages(ctx.tenantId)).stages
  const [names, custs] = await Promise.all([
    namesFor(
      ctx.tenantId,
      rows.flatMap((r) => r.assignedUserIds),
    ),
    customerNamesFor(
      ctx,
      rows.map((r) => r.customerId),
    ),
  ])
  return rows.map((r) => toJobDto(r, st, names, custs))
}

// ---- helpers ---------------------------------------------------------------------------------------

function parseAt(at: string | undefined, now: Date): Date {
  if (!at) return now
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'validation.invalidFormat')
  if (d.getTime() > now.getTime() + MAX_FUTURE_MS) throw new AppError(400, 'jobs.timeInFuture')
  return d
}

function provenance(
  body: { clientOffsetMs?: number; timestampSource?: string },
  at: Date,
  now: Date,
) {
  const out: Record<string, unknown> = {}
  if (body.timestampSource) out.timestampSource = body.timestampSource
  if (body.clientOffsetMs !== undefined) out.clientOffsetMs = body.clientOffsetMs
  if (body.timestampSource === 'device' && clockSuspect(at, now, body.clientOffsetMs))
    out.qualityFlags = ['clockSuspect']
  return out
}

async function load(ctx: Ctx, id: string, tx?: Tx): Promise<JobRow> {
  const j = await repo.findJob(ctx.tenantId, id, tx)
  if (!j) throw notFound()
  // Technicians act on (and see) only the jobs assigned to them.
  if (ctx.role === 'technician' && !j.assignedUserIds.includes(ctx.userId)) throw notFound()
  return j
}

function requireOffice(ctx: Ctx) {
  if (ctx.role === 'technician') throw new AppError(403, 'auth.forbidden')
}

async function recomputeTotals(tenantId: string, job: JobRow, tx: Tx): Promise<JobRow> {
  const lines = await repo.linesOf(tenantId, job.id, job.quoteVersion, tx)
  const t = quoteTotals(lines, job.vatRatePercent)
  return repo.updateJob(tenantId, job.id, t, tx)
}

async function appendTransition(
  ctx: Ctx,
  source: EventSource,
  job: JobRow,
  to: string,
  at: Date,
  data: Record<string, unknown>,
  tx: Tx,
) {
  await repo.appendEvent(
    ctx.tenantId,
    {
      jobId: job.id,
      type: 'transition',
      fromStatus: job.status,
      toStatus: to,
      at,
      source,
      byUserId: ctx.userId || null,
      data,
    },
    tx,
  )
  await audit(
    actor(ctx),
    {
      action: `job.${to}`,
      entityType: 'job',
      entityId: job.id,
      before: { status: job.status },
      after: { status: to, ...data },
    },
    tx,
  )
}

const EVENT_BY_STAGE: Record<string, string> = {
  quoted: 'JobQuoted',
  approved: 'JobApproved',
  scheduled: 'JobScheduled',
  in_progress: 'JobStarted',
  done: 'JobCompleted',
  invoiced: 'JobInvoiced',
  rejected: 'JobRejected',
  cancelled: 'JobCancelled',
}

async function publishStage(ctx: Ctx, job: JobRow, extra: Record<string, unknown> = {}) {
  const type = EVENT_BY_STAGE[job.status]
  if (!type) return
  await events.publish(ctx, {
    type,
    aggregateType: 'job',
    aggregateId: job.id,
    payload: {
      elevatorId: job.elevatorId,
      buildingId: job.buildingId,
      status: job.status,
      title: job.title,
      totalCents: job.totalCents,
      assignedUserIds: job.assignedUserIds,
      ...extra,
    },
  })
}

function assertCan(stages: StageDef[], job: JobRow, to: string) {
  if (!stageOf(stages, to)) throw new AppError(400, 'jobs.unknownStage', { detail: to })
  if (!canTransition(stages, job.status, to))
    throw new AppError(409, 'jobs.invalidTransition', {
      params: { from: job.status, to },
    })
}

function addMonthsDateOnly(dateOnly: string, months: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
  dt.setUTCDate(Math.min(d, last))
  return dt.toISOString().slice(0, 10)
}

// ---- commands --------------------------------------------------------------------------------------

/** Creates a job (draft) with optional lines; idempotent on a client id. */
export async function create(ctx: Ctx, body: CreateJobBody, source: EventSource = 'office') {
  requireOffice(ctx)
  const stages = (await effectiveStages(ctx.tenantId)).stages
  if (body.id) {
    const existing = await repo.findJob(ctx.tenantId, body.id)
    if (existing) return (await dtos(ctx, [existing], stages))[0]!
  }
  const elevator = await elevators.find(ctx.tenantId, body.elevatorId)
  if (!elevator) throw notFound()
  if (body.customerId && !(await customers.get(ctx, body.customerId).catch(() => null)))
    throw notFound()
  const settings = await getTenantSettings(ctx.tenantId)
  const building = await buildings.find(ctx.tenantId, elevator.buildingId)
  const now = clock.now()
  const created = await transaction(async (tx) => {
    const j = await repo.createJob(
      ctx.tenantId,
      {
        id: body.id,
        elevatorId: elevator.id,
        buildingId: elevator.buildingId,
        customerId: body.customerId ?? building?.customerId ?? null,
        kind: body.kind,
        title: body.title,
        description: body.description ?? null,
        originType: body.originType,
        originId: body.originId ?? null,
        vatRatePercent: settings.vatRatePercent,
        notes: body.notes ?? null,
        createdByUserId: ctx.userId || null,
      },
      tx,
    )
    let pos = 0
    for (const l of body.lines) {
      await repo.createLine(ctx.tenantId, lineInput(j, l, pos++), tx)
    }
    const withTotals = body.lines.length ? await recomputeTotals(ctx.tenantId, j, tx) : j
    await repo.appendEvent(
      ctx.tenantId,
      {
        jobId: j.id,
        type: 'created',
        toStatus: j.status,
        at: now,
        source,
        byUserId: ctx.userId || null,
        data: { originType: j.originType, originId: j.originId, kind: j.kind },
      },
      tx,
    )
    await audit(
      actor(ctx),
      {
        action: 'job.create',
        entityType: 'job',
        entityId: j.id,
        after: { elevatorId: j.elevatorId, title: j.title, originType: j.originType },
      },
      tx,
    )
    return withTotals
  })
  await events.publish(ctx, {
    type: 'JobCreated',
    aggregateType: 'job',
    aggregateId: created.id,
    payload: {
      elevatorId: created.elevatorId,
      buildingId: created.buildingId,
      kind: created.kind,
      title: created.title,
      originType: created.originType,
      originId: created.originId,
    },
  })
  return (await dtos(ctx, [created], stages))[0]!
}

function lineInput(job: JobRow, l: JobLineInput, position: number): repo.LineInput {
  return {
    jobId: job.id,
    quoteVersion: job.quoteVersion,
    kind: l.kind,
    description: l.description,
    qty: l.qty,
    unitCents: l.unitCents,
    totalCents: lineTotalCents(l.qty, l.unitCents),
    partRef: l.partRef ?? null,
    position,
  }
}

export async function update(ctx: Ctx, id: string, body: UpdateJobBody): Promise<JobDto> {
  requireOffice(ctx)
  const before = await load(ctx, id)
  if (body.customerId && !(await customers.get(ctx, body.customerId).catch(() => null)))
    throw notFound()
  const j = await repo.updateJob(ctx.tenantId, id, {
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.customerId !== undefined ? { customerId: body.customerId } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.warrantyUntil !== undefined
      ? { warrantyUntil: body.warrantyUntil ? fromDateOnly(body.warrantyUntil) : null }
      : {}),
  })
  await audit(actor(ctx), {
    action: 'job.update',
    entityType: 'job',
    entityId: id,
    before: { title: before.title, kind: before.kind },
    after: { title: j.title, kind: j.kind },
  })
  return (await dtos(ctx, [j]))[0]!
}

function assertEditable(job: JobRow) {
  if (!JOB_EDITABLE_STAGES.includes(job.status))
    throw new AppError(409, 'jobs.linesLocked', { params: { status: job.status } })
}

export async function addLine(ctx: Ctx, id: string, body: JobLineInput): Promise<JobDetailDto> {
  requireOffice(ctx)
  await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    assertEditable(job)
    const existing = await repo.linesOf(ctx.tenantId, job.id, job.quoteVersion, tx)
    await repo.createLine(ctx.tenantId, lineInput(job, body, existing.length), tx)
    await recomputeTotals(ctx.tenantId, job, tx)
    await repo.appendEvent(
      ctx.tenantId,
      {
        jobId: job.id,
        type: 'line_added',
        at: clock.now(),
        source: 'office',
        byUserId: ctx.userId,
        data: {
          description: body.description,
          totalCents: lineTotalCents(body.qty, body.unitCents),
        },
      },
      tx,
    )
  })
  return get(ctx, id)
}

export async function updateLine(
  ctx: Ctx,
  id: string,
  lineId: string,
  body: UpdateJobLineBody,
): Promise<JobDetailDto> {
  requireOffice(ctx)
  await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    assertEditable(job)
    const line = await repo.findLine(ctx.tenantId, job.id, lineId, tx)
    if (!line || line.quoteVersion !== job.quoteVersion) throw notFound()
    const qty = body.qty ?? line.qty
    const unitCents = body.unitCents ?? line.unitCents
    await repo.updateLine(
      ctx.tenantId,
      line.id,
      {
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.partRef !== undefined ? { partRef: body.partRef } : {}),
        qty,
        unitCents,
        totalCents: lineTotalCents(qty, unitCents),
      },
      tx,
    )
    await recomputeTotals(ctx.tenantId, job, tx)
  })
  return get(ctx, id)
}

export async function removeLine(ctx: Ctx, id: string, lineId: string): Promise<JobDetailDto> {
  requireOffice(ctx)
  await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    assertEditable(job)
    const line = await repo.findLine(ctx.tenantId, job.id, lineId, tx)
    if (!line || line.quoteVersion !== job.quoteVersion) throw notFound()
    await repo.deleteLine(ctx.tenantId, line.id, tx)
    await recomputeTotals(ctx.tenantId, job, tx)
    await repo.appendEvent(
      ctx.tenantId,
      {
        jobId: job.id,
        type: 'line_removed',
        at: clock.now(),
        source: 'office',
        byUserId: ctx.userId,
        data: { description: line.description, totalCents: line.totalCents },
      },
      tx,
    )
  })
  return get(ctx, id)
}

/**
 * Generic stage change through the data-driven machine. Dedicated commands (schedule, start,
 * complete, invoice, send-quote) call the same core; the endpoint refuses `done` and `invoiced`
 * because those need the visit / the invoice, and `scheduled` without a date.
 */
export async function transition(
  ctx: Ctx,
  id: string,
  body: JobTransitionBody,
  source: EventSource = 'office',
): Promise<JobDto> {
  requireOffice(ctx)
  if (body.to === 'done' || body.to === 'invoiced')
    throw new AppError(409, 'jobs.useCommand', { params: { to: body.to } })
  const now = clock.now()
  const at = parseAt(body.at, now)
  const stages = (await effectiveStages(ctx.tenantId)).stages
  const updated = await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    assertCan(stages, job, body.to)
    const patch: repo.JobPatch = { status: body.to }
    const data: Record<string, unknown> = {}
    if (requiresEvidence(stages, body.to)) {
      if (!body.evidence) throw new AppError(400, 'jobs.evidenceRequired')
      const ev = { ...body.evidence, at: body.evidence.at ?? at.toISOString() }
      patch.approvalEvidence = ev as object
      patch.approvedAt = new Date(ev.at)
      data.evidence = ev
    }
    if (body.to === 'rejected') {
      if (!body.reason) throw new AppError(400, 'jobs.reasonRequired')
      patch.rejectedReason = body.reason
      data.reason = body.reason
    }
    if (body.to === 'cancelled') {
      if (!body.reason) throw new AppError(400, 'jobs.reasonRequired')
      patch.cancelledReason = body.reason
      data.reason = body.reason
    }
    if (body.to === 'quoted' || body.to === 'awaiting_approval') {
      const lines = await repo.linesOf(ctx.tenantId, job.id, job.quoteVersion, tx)
      if (lines.length === 0) throw new AppError(409, 'jobs.noLines')
      if (body.to === 'awaiting_approval' && !job.quoteSentAt) patch.quoteSentAt = at
    }
    if (body.to === 'scheduled' && !job.scheduledAt)
      throw new AppError(409, 'jobs.useCommand', { params: { to: 'scheduled' } })
    if (body.to === 'in_progress' && !job.startedAt) patch.startedAt = at
    if (body.to === 'draft') {
      // Back to the drawing board: a new quote version keeps the old lines as history.
      patch.quoteVersion = job.quoteVersion + 1
      patch.approvalEvidence = undefined
      patch.rejectedReason = null
      const old = await repo.linesOf(ctx.tenantId, job.id, job.quoteVersion, tx)
      for (const l of old) {
        await repo.createLine(
          ctx.tenantId,
          {
            jobId: job.id,
            quoteVersion: job.quoteVersion + 1,
            kind: l.kind,
            description: l.description,
            qty: l.qty,
            unitCents: l.unitCents,
            totalCents: l.totalCents,
            partRef: l.partRef,
            position: l.position,
          },
          tx,
        )
      }
      data.quoteVersion = job.quoteVersion + 1
    }
    if (body.reason && body.to !== 'rejected' && body.to !== 'cancelled') data.reason = body.reason
    await appendTransition(ctx, source, job, body.to, at, data, tx)
    return repo.updateJob(ctx.tenantId, job.id, patch, tx)
  })
  await publishStage(ctx, updated)
  return (await dtos(ctx, [updated], stages))[0]!
}

/** Marks the quote ready (draft -> quoted). */
export function markQuoted(ctx: Ctx, id: string): Promise<JobDto> {
  return transition(ctx, id, { to: 'quoted' })
}

/**
 * Sends the quote: moves the job to `awaiting_approval` (from draft / quoted), stamps
 * quoteSentAt and the validity, and - through the QuoteNotifier port - e-mails the document or
 * builds a Viber link the office user sends by hand. `none` only records the hand-over.
 */
export async function sendQuote(
  ctx: Ctx,
  id: string,
  body: SendQuoteBody,
): Promise<SendQuoteResultDto> {
  requireOffice(ctx)
  const settings = await getTenantSettings(ctx.tenantId)
  const now = clock.now()
  const validDays = body.validDays ?? settings.jobs.quoteValidDays
  const validUntil = addDays(todayInSofia(now), validDays)
  const stages = (await effectiveStages(ctx.tenantId)).stages
  let job = await load(ctx, id)
  if (job.status !== 'awaiting_approval') {
    if (job.status === 'draft') {
      await transition(ctx, id, { to: 'quoted' })
      job = await load(ctx, id)
    }
    await transition(ctx, id, { to: 'awaiting_approval' })
  }
  job = await repo.updateJob(ctx.tenantId, id, {
    quoteSentAt: now,
    quoteValidUntil: fromDateOnly(validUntil),
  })
  const detail = await get(ctx, id)
  const tenant = await getTenant(ctx.tenantId)
  const base = config.BASE_PATH === '/' ? '' : config.BASE_PATH
  const printUrl = `${base}/print/quote/${id}`
  const notifier = quoteNotifier()
  let viber: SendQuoteResultDto['viber'] = null
  let notificationId: string | null = null
  const data = {
    job: {
      id: job.id,
      title: job.title,
      totalCents: job.totalCents,
      netCents: job.netCents,
      validUntil,
      validUntilLabel: formatDate(validUntil, ctx.locale),
      message: body.message ?? '',
    },
    building: { id: job.buildingId, addressText: job.building.addressText },
    elevator: { id: job.elevatorId, internalNo: job.elevator.internalNo },
    customer: { name: detail.customerName ?? '' },
    contact: { name: '' },
  }
  if (body.channel === 'email') {
    if (!body.email) throw new AppError(400, 'jobs.emailRequired')
    if (!notifier) throw new AppError(500, 'notifications.templateMissing')
    const html = renderQuoteHtml(detail, tenant, ctx.t, {
      lang: ctx.locale,
      validUntil,
      message: body.message ?? null,
    })
    const n = await notifier.sendEmail(ctx.tenantId, {
      key: 'quote_sent',
      to: body.email,
      data,
      relatedType: 'job',
      relatedId: job.id,
      attachments: [
        {
          filename: `oferta-${job.id.slice(-6)}.html`,
          content: html,
          contentType: 'text/html; charset=utf-8',
        },
      ],
      locale: ctx.locale,
    })
    notificationId = n.id
  } else if (body.channel === 'viber') {
    if (!body.phone) throw new AppError(400, 'jobs.phoneRequired')
    if (!notifier) throw new AppError(500, 'notifications.templateMissing')
    const v = await notifier.viberLink(ctx.tenantId, {
      key: 'quote_sent',
      phone: body.phone,
      data,
      relatedType: 'job',
      relatedId: job.id,
      locale: ctx.locale,
    })
    viber = { url: v.url, text: v.text }
    notificationId = v.id
  }
  await repo.appendEvent(ctx.tenantId, {
    jobId: job.id,
    type: 'quote_sent',
    at: now,
    source: 'office',
    byUserId: ctx.userId,
    data: {
      channel: body.channel,
      to: body.email ?? body.phone ?? null,
      validUntil,
      notificationId,
    },
  })
  await audit(actor(ctx), {
    action: 'job.sendQuote',
    entityType: 'job',
    entityId: job.id,
    after: { channel: body.channel, validUntil },
  })
  return { job: (await dtos(ctx, [job], stages))[0]!, viber, notificationId, printUrl }
}

/** A new quote version (draft) copying the current lines; the old lines stay as history. */
export function revise(ctx: Ctx, id: string, reason?: string | null): Promise<JobDto> {
  return transition(ctx, id, { to: 'draft', reason: reason ?? null })
}

export async function schedule(ctx: Ctx, id: string, body: ScheduleJobBody): Promise<JobDto> {
  requireOffice(ctx)
  const now = clock.now()
  const stages = (await effectiveStages(ctx.tenantId)).stages
  await load(ctx, id)
  const users = await findUsersByIds(ctx.tenantId, body.assignedUserIds)
  if (users.length !== new Set(body.assignedUserIds).size || users.some((u) => !u.isActive))
    throw new AppError(400, 'jobs.userNotFound')
  const scheduledAt = new Date(body.scheduledAt)
  const updated = await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    // Re-scheduling a scheduled job is a plain update, not a transition.
    if (job.status !== 'scheduled') assertCan(stages, job, 'scheduled')
    const data = {
      scheduledAt: scheduledAt.toISOString(),
      assignedUserIds: body.assignedUserIds,
      notes: body.notes ?? null,
    }
    if (job.status !== 'scheduled')
      await appendTransition(ctx, 'office', job, 'scheduled', now, data, tx)
    else
      await repo.appendEvent(
        ctx.tenantId,
        {
          jobId: job.id,
          type: 'rescheduled',
          at: now,
          source: 'office',
          byUserId: ctx.userId,
          data,
        },
        tx,
      )
    return repo.updateJob(
      ctx.tenantId,
      job.id,
      { status: 'scheduled', scheduledAt, assignedUserIds: body.assignedUserIds },
      tx,
    )
  })
  await publishStage(ctx, updated, { scheduledAt: updated.scheduledAt?.toISOString() })
  return (await dtos(ctx, [updated], stages))[0]!
}

/** Technician (assigned) or office: the work starts on site. Idempotent when already in progress. */
export async function start(
  ctx: Ctx,
  id: string,
  body: StartJobBody,
  source: EventSource = 'office',
): Promise<JobDto> {
  const now = clock.now()
  const at = parseAt(body.at, now)
  const stages = (await effectiveStages(ctx.tenantId)).stages
  const updated = await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    if (job.status === 'in_progress') return job
    assertCan(stages, job, 'in_progress')
    const data = { ...provenance(body, at, now), ...(body.notes ? { notes: body.notes } : {}) }
    await appendTransition(ctx, source, job, 'in_progress', at, data, tx)
    return repo.updateJob(
      ctx.tenantId,
      job.id,
      {
        status: 'in_progress',
        startedAt: job.startedAt ?? at,
        ...(body.notes ? { notes: job.notes ? `${job.notes}\n${body.notes}` : body.notes } : {}),
        // A technician who starts without being assigned joins the job.
        ...(ctx.role === 'technician' && !job.assignedUserIds.includes(ctx.userId)
          ? { assignedUserIds: [...job.assignedUserIds, ctx.userId] }
          : {}),
      },
      tx,
    )
  })
  await publishStage(ctx, updated)
  return (await dtos(ctx, [updated], stages))[0]!
}

/** A note from the site or the office (append-only event + the notes column). */
export async function addNote(
  ctx: Ctx,
  id: string,
  body: JobNoteBody,
  source: EventSource = 'office',
): Promise<JobDto> {
  const now = clock.now()
  const at = parseAt(body.at, now)
  const updated = await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    await repo.appendEvent(
      ctx.tenantId,
      {
        jobId: job.id,
        type: 'note',
        at,
        source,
        byUserId: ctx.userId || null,
        data: { notes: body.notes, ...provenance(body, at, now) },
      },
      tx,
    )
    return repo.updateJob(
      ctx.tenantId,
      job.id,
      { notes: job.notes ? `${job.notes}\n${body.notes}` : body.notes },
      tx,
    )
  })
  return (await dtos(ctx, [updated]))[0]!
}

/**
 * Completion: `done`, completedAt, the warranty, and the repair visit through the VisitRecorder
 * port (kind `repair`, the assigned technicians, the phone's attachment links) so the work shows
 * in the elevator's history. Idempotent for the technician app: a job already done with the
 * same visitId returns as is. The visit is written after the transition commits; a failure there
 * leaves visitId null (visible in the UI) and never un-completes the job.
 */
export async function complete(
  ctx: Ctx,
  id: string,
  body: CompleteJobBody,
  source: EventSource = 'office',
): Promise<JobDto> {
  const now = clock.now()
  const at = parseAt(body.at, now)
  const settings = await getTenantSettings(ctx.tenantId)
  const stages = (await effectiveStages(ctx.tenantId)).stages
  const existing = await load(ctx, id)
  if (existing.status === 'done' || existing.status === 'invoiced') {
    if (body.visitId && existing.visitId === body.visitId)
      return (await dtos(ctx, [existing], stages))[0]!
    throw new AppError(409, 'jobs.invalidTransition', {
      params: { from: existing.status, to: 'done' },
    })
  }
  const warrantyMonths = body.warrantyMonths ?? settings.jobs.defaultWarrantyMonths
  const updated = await transaction(async (tx) => {
    const job = await load(ctx, id, tx)
    assertCan(stages, job, 'done')
    const startedAt = body.startedAt ? new Date(body.startedAt) : (job.startedAt ?? at)
    const data = {
      ...provenance(body, at, now),
      ...(body.notes ? { notes: body.notes } : {}),
      ...(body.partsUsed ? { partsUsed: body.partsUsed } : {}),
      warrantyMonths,
    }
    await appendTransition(ctx, source, job, 'done', at, data, tx)
    return repo.updateJob(
      ctx.tenantId,
      job.id,
      {
        status: 'done',
        startedAt,
        completedAt: at,
        warrantyUntil:
          warrantyMonths > 0
            ? fromDateOnly(addMonthsDateOnly(todayInSofia(at), warrantyMonths))
            : null,
        ...(body.notes ? { notes: job.notes ? `${job.notes}\n${body.notes}` : body.notes } : {}),
        ...(ctx.role === 'technician' && !job.assignedUserIds.includes(ctx.userId)
          ? { assignedUserIds: [...job.assignedUserIds, ctx.userId] }
          : {}),
      },
      tx,
    )
  })
  let final = updated
  if (body.createVisit) {
    try {
      const techIds = body.technicianUserIds?.length
        ? body.technicianUserIds
        : updated.assignedUserIds.length
          ? updated.assignedUserIds
          : ctx.userId
            ? [ctx.userId]
            : []
      const notes = [
        updated.title,
        body.notes,
        body.partsUsed ? `${ctx.t('jobs.partsUsed')}: ${body.partsUsed}` : null,
      ]
        .filter(Boolean)
        .join('\n')
      const visit = await visitRecorder().record(ctx, {
        id: body.visitId,
        elevatorId: updated.elevatorId,
        kind: 'repair',
        startedAt: (updated.startedAt ?? at).toISOString(),
        endedAt: at.toISOString(),
        technicians: techIds.length
          ? techIds.map((userId) => ({ userId }))
          : [{ name: ctx.t('jobs.unknownTechnician') }],
        notes,
        source: source === 'app' ? 'app' : 'office',
        timestampSource: body.timestampSource ?? 'server',
        clientOffsetMs: body.clientOffsetMs ?? 0,
        attachments: body.attachments,
      })
      final = await repo.updateJob(ctx.tenantId, updated.id, { visitId: visit.id })
    } catch (err) {
      logger.error({ err, jobId: updated.id }, 'repair visit not recorded for the job')
    }
  }
  await publishStage(ctx, final, {
    visitId: final.visitId,
    completedAt: final.completedAt?.toISOString(),
  })
  return (await dtos(ctx, [final], stages))[0]!
}

/**
 * Invoice through the billing port. `full` (from `done`): the remaining lines, a deposit already
 * invoiced deducted as a negative line, then the job becomes `invoiced`. `partial` (deposit /
 * instalment, from approved onwards): one line with the amount; the job stays where it is until
 * the invoiced amount covers the net total.
 */
export async function invoice(ctx: Ctx, id: string, body: InvoiceJobBody): Promise<JobDetailDto> {
  requireOffice(ctx)
  const stages = (await effectiveStages(ctx.tenantId)).stages
  const job = await load(ctx, id)
  if (!job.customerId) throw new AppError(409, 'jobs.customerRequired')
  const lines = await repo.linesOf(ctx.tenantId, job.id, job.quoteVersion)
  const remaining = remainingNetCents(job)
  let invoiceLines: InvoiceLineDto[]
  let netCents: number
  if (body.kind === 'partial') {
    if (!['approved', 'scheduled', 'in_progress', 'done'].includes(job.status))
      throw new AppError(409, 'jobs.invalidTransition', {
        params: { from: job.status, to: 'invoiced' },
      })
    if (!body.amountCents) throw new AppError(400, 'jobs.amountRequired')
    if (body.amountCents > remaining) throw new AppError(400, 'jobs.amountAboveRemaining')
    netCents = body.amountCents
    invoiceLines = [
      {
        elevatorId: job.elevatorId,
        description: body.description ?? ctx.t('jobs.invoice.depositLine', { title: job.title }),
        amountCents: body.amountCents,
      },
    ]
  } else {
    assertCan(stages, job, 'invoiced')
    if (remaining <= 0) throw new AppError(409, 'jobs.nothingToInvoice')
    invoiceLines = lines
      .filter((l) => l.totalCents !== 0)
      .map((l) => ({
        elevatorId: job.elevatorId,
        description: `${l.description}${l.qty !== 1 ? ` × ${l.qty}` : ''}`,
        amountCents: l.totalCents,
      }))
    if (job.invoicedCents > 0)
      invoiceLines.push({
        elevatorId: job.elevatorId,
        description: ctx.t('jobs.invoice.depositDeducted'),
        amountCents: -job.invoicedCents,
      })
    if (body.description)
      invoiceLines.unshift({
        elevatorId: job.elevatorId,
        description: body.description,
        amountCents: 0,
      })
    netCents = remaining
  }
  const inv = await invoiceIssuer().issue(ctx, {
    sourceType: 'job',
    sourceId: job.id,
    buildingId: job.buildingId,
    customerId: job.customerId,
    lines: invoiceLines,
    issuedAt: body.issuedAt,
    dueAt: body.dueAt,
  })
  const invoicedCents = job.invoicedCents + netCents
  const becomesInvoiced = body.kind === 'full' || invoicedCents >= job.netCents
  const now = clock.now()
  const updated = await transaction(async (tx) => {
    const data = {
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      kind: body.kind,
      netCents,
      totalCents: inv.totalCents,
    }
    if (becomesInvoiced && job.status !== 'invoiced')
      await appendTransition(ctx, 'office', job, 'invoiced', now, data, tx)
    else
      await repo.appendEvent(
        ctx.tenantId,
        {
          jobId: job.id,
          type: 'invoice_partial',
          at: now,
          source: 'office',
          byUserId: ctx.userId,
          data,
        },
        tx,
      )
    return repo.updateJob(
      ctx.tenantId,
      job.id,
      { invoiceId: inv.id, invoicedCents, ...(becomesInvoiced ? { status: 'invoiced' } : {}) },
      tx,
    )
  })
  if (becomesInvoiced)
    await publishStage(ctx, updated, { invoiceId: inv.id, invoiceNumber: inv.number })
  return get(ctx, id)
}

export function reject(ctx: Ctx, id: string, body: JobReasonBody): Promise<JobDto> {
  return transition(ctx, id, { to: 'rejected', reason: body.reason, at: body.at })
}

export function cancel(ctx: Ctx, id: string, body: JobReasonBody): Promise<JobDto> {
  return transition(ctx, id, { to: 'cancelled', reason: body.reason, at: body.at })
}

// ---- queries -----------------------------------------------------------------------------------------

export async function get(ctx: Ctx, id: string): Promise<JobDetailDto> {
  const j: JobDetailRow | null = await repo.findJobDetail(ctx.tenantId, id)
  if (!j) throw notFound()
  if (ctx.role === 'technician' && !j.assignedUserIds.includes(ctx.userId)) throw notFound()
  const stages = (await effectiveStages(ctx.tenantId)).stages
  const [names, custs] = await Promise.all([
    namesFor(ctx.tenantId, [
      ...j.assignedUserIds,
      j.createdByUserId,
      ...j.events.map((e) => e.byUserId),
    ]),
    customerNamesFor(ctx, [j.customerId]),
  ])
  const invoices =
    ctx.role === 'technician'
      ? []
      : await invoiceIssuer()
          .listForSource(ctx, 'job', j.id)
          .catch(() => [])
  const dto = toJobDto(j, stages, names, custs)
  return {
    ...dto,
    lines: j.lines.filter((l) => l.quoteVersion === j.quoteVersion).map(toLineDto),
    previousLines: j.lines.filter((l) => l.quoteVersion !== j.quoteVersion).map(toLineDto),
    events: j.events.map((e) => toEventDto(e, names)),
    invoices,
  }
}

function parseStatuses(s: string | undefined): string[] | undefined {
  if (!s) return undefined
  const list = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

export async function list(ctx: Ctx, q: JobListQuery): Promise<Page<JobDto>> {
  const eff = await effectiveStages(ctx.tenantId)
  const statuses = parseStatuses(q.status) ?? (q.open ? openStageCodes(eff.stages) : undefined)
  const rows = await repo.listJobs(ctx.tenantId, {
    cursor: q.cursor,
    limit: q.limit,
    statuses:
      q.open === false ? eff.stages.filter((s) => s.isTerminal).map((s) => s.code) : statuses,
    elevatorId: q.elevatorId,
    buildingId: q.buildingId,
    customerId: q.customerId,
    assignedUserId: q.assignedUserId,
    kind: q.kind,
    originType: q.originType,
    originId: q.originId,
    q: q.q,
    from: fromDateOnly(q.from) ?? undefined,
    to: q.to ? fromDateOnly(addDays(q.to, 1))! : undefined,
    visibleToUserId: ctx.role === 'technician' ? ctx.userId : undefined,
  })
  return page(ctx, rows, q.limit, eff.stages)
}

export async function listForElevator(
  ctx: Ctx,
  elevatorId: string,
  q: { cursor?: string; limit: number },
): Promise<Page<JobDto>> {
  if (!(await elevators.find(ctx.tenantId, elevatorId))) throw notFound()
  const rows = await repo.listJobs(ctx.tenantId, {
    ...q,
    elevatorId,
    visibleToUserId: ctx.role === 'technician' ? ctx.userId : undefined,
  })
  return page(ctx, rows, q.limit)
}

async function page(
  ctx: Ctx,
  rows: JobRow[],
  limit: number,
  stages?: StageDef[],
): Promise<Page<JobDto>> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return {
    items: await dtos(ctx, items, stages),
    nextCursor: hasMore ? repo.cursorOf(items[items.length - 1]!) : null,
  }
}

/** Jobs already created from these origins (defect / callback / visit ids) -> the newest job each. */
export async function byOrigin(
  ctx: Ctx,
  originType: 'visit' | 'callback' | 'defect',
  originIds: string[],
): Promise<Record<string, { id: string; status: string; title: string }>> {
  const rows = await repo.listByOrigins(ctx.tenantId, originType, originIds)
  const out: Record<string, { id: string; status: string; title: string }> = {}
  for (const r of rows) {
    if (!r.originId || out[r.originId]) continue
    out[r.originId] = { id: r.id, status: r.status, title: r.title }
  }
  return out
}

/** Monday 00:00 (Sofia) of the week containing `today` and the next Monday, as UTC dates. */
function weekBounds(today: string): { weekStart: Date; weekEnd: Date } {
  const d = new Date(today + 'T00:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7
  const monday = addDays(today, -dow)
  return {
    weekStart: new Date(monday + 'T00:00:00+03:00'),
    weekEnd: new Date(addDays(monday, 7) + 'T00:00:00+03:00'),
  }
}

export async function summary(tenantId: string): Promise<JobsSummaryDto> {
  const settings = await getTenantSettings(tenantId)
  const rows = await repo.listByStatuses(tenantId, [
    'quoted',
    'awaiting_approval',
    'scheduled',
    'in_progress',
    'done',
  ])
  const now = clock.now()
  return summarizeJobs(rows, {
    now,
    approvalReminderDays: settings.jobs.approvalReminderDays,
    ...weekBounds(todayInSofia(now)),
  })
}

/** Sync pull: jobs assigned to me that are approved / scheduled / in progress (full replace). */
export async function listForSync(ctx: Ctx): Promise<JobDto[]> {
  const rows = await repo.listForSync(ctx.tenantId, ctx.userId, [
    'approved',
    'scheduled',
    'in_progress',
  ])
  return dtos(ctx, rows)
}

/** Jobs awaiting approval past the reminder window (calendar items + the reminder job). */
export async function awaitingApprovalRows(
  tenantId: string,
): Promise<Array<{ job: JobRow; dueAt: Date; overdue: boolean }>> {
  const settings = await getTenantSettings(tenantId)
  const now = clock.now()
  const days = settings.jobs.approvalReminderDays
  return (await repo.listByStatuses(tenantId, ['awaiting_approval'])).map((job) => ({
    job,
    dueAt: approvalDueAt(job, days),
    overdue: approvalOverdue(job, now, days),
  }))
}

/**
 * Daily reminder (cron `jobs.approvalReminders`): every job awaiting approval longer than
 * `settings.jobs.approvalReminderDays` gets one in-app note to the office per week
 * (`JobApprovalReminder` event, deduped per job for 7 days).
 */
export async function remindApprovals(
  tenantId: string,
  locale = 'bg',
): Promise<{ reminded: number }> {
  const rows = await awaitingApprovalRows(tenantId)
  const since = new Date(clock.now().getTime() - 7 * 86_400_000)
  let reminded = 0
  for (const { job, overdue } of rows) {
    if (!overdue) continue
    if (await events.alreadyPublished('JobApprovalReminder', job.id, since)) continue
    const sentAt = job.quoteSentAt ?? job.updatedAt
    const days = Math.floor((clock.now().getTime() - sentAt.getTime()) / 86_400_000)
    const ev = await events.publish(
      { tenantId },
      {
        type: 'JobApprovalReminder',
        aggregateType: 'job',
        aggregateId: job.id,
        payload: {
          elevatorId: job.elevatorId,
          buildingId: job.buildingId,
          days,
          totalCents: job.totalCents,
        },
      },
    )
    const notifier = quoteNotifier()
    if (notifier) {
      await notifier.notifyOffice(tenantId, {
        key: 'job_approval_reminder',
        data: {
          job: { id: job.id, title: job.title, totalCents: job.totalCents, days },
          building: { id: job.buildingId, addressText: job.building.addressText },
          elevator: { id: job.elevatorId, internalNo: job.elevator.internalNo },
          locale,
        },
        relatedType: 'job',
        relatedId: job.id,
        link: `/jobs/${job.id}`,
        eventId: ev.id,
        eventType: ev.type,
      })
    }
    reminded++
  }
  return { reminded }
}

/** The printable quote (print facade). */
export async function quoteHtml(
  ctx: Ctx,
  id: string,
  o: { toolbar?: boolean; scriptUrl?: string },
): Promise<string> {
  const [detail, tenant] = await Promise.all([get(ctx, id), getTenant(ctx.tenantId)])
  return renderQuoteHtml(detail, tenant, ctx.t, { ...o, lang: ctx.locale })
}
