import { Router } from 'express'
import type { Request } from 'express'
import { CLIENT_VERSION_HEADER, syncPullQuery, syncPushItem } from '@avroleva/contracts'
import type {
  ChecklistTemplateDto,
  SyncBuildingDto,
  SyncContactDto,
  SyncElevatorDto,
  SyncJobDto,
  SyncPullDto,
  SyncPushResultDto,
} from '@avroleva/contracts'
import { addDays, clock, toDateOnly, todayInSofia } from '../platform/clock.js'
import type { Ctx } from '../platform/http/ctx.js'
import { ctxOf, requireAuth } from '../platform/http/ctx.js'
import { idempotent, sweepIdempotencyKeys } from '../platform/http/idempotency.js'
import { parseBody, parseQuery } from '../platform/http/validate.js'
import { AppError } from '../platform/http/errors.js'
import { getTenant, listUsers, noteClientVersion } from '../modules/tenancy/index.js'
import { buildings, contacts, elevators } from '../modules/registry/index.js'
import { checklists, dueState } from '../modules/maintenance/index.js'
import * as visits from '../modules/visits/index.js'
import * as callbacks from '../modules/callbacks/index.js'
import * as defects from '../modules/defects/index.js'
import * as repairJobsModule from '../modules/jobs/index.js'

/**
 * Sync facade of the technician app (ARCHITECTURE section 4). Composes the modules' public
 * interfaces (L4-style, like reporting): never touches a repo directly.
 *
 * Pull: everything with `updatedAt >= since - 2 s` per collection plus soft-delete tombstones and
 * `serverTime` (the phone measures its clock offset from it). Open work (jobs, open callbacks,
 * open defects) is a full replace - the phone drops what is no longer listed.
 * Push: ONE outbox item per request under `Idempotency-Key = item id`; same key + same body
 * replays the stored answer, same key + different body is 422.
 */
export const syncRouter = Router()
syncRouter.use(requireAuth)

const OVERLAP_MS = 2000
const FIRST_PULL_VISIT_DAYS = 90
let pushCounter = 0

function noteVersion(req: Request) {
  const v = req.header(CLIENT_VERSION_HEADER)
  if (v && req.ctx) void noteClientVersion(req.ctx.sessionId, v.slice(0, 40))
}

syncRouter.get('/sync/pull', async (req, res) => {
  const ctx = ctxOf(req)
  noteVersion(req)
  const q = parseQuery(syncPullQuery, req)
  const now = clock.now()
  const since = q.since ? new Date(new Date(q.since).getTime() - OVERLAP_MS) : null
  res.json(await pull(ctx, since, now))
})

export async function pull(ctx: Ctx, since: Date | null, now: Date): Promise<SyncPullDto> {
  const today = todayInSofia(now)
  const tomorrow = addDays(today, 1)
  const [
    tenant,
    users,
    buildingRows,
    elevatorRows,
    contactRows,
    templates,
    openCallbacks,
    openDefects,
    repairJobs,
  ] = await Promise.all([
    getTenant(ctx.tenantId),
    listUsers(ctx),
    buildings.listAllForSync(ctx.tenantId, since),
    elevators.listAllForSync(ctx.tenantId, since),
    contacts.listAllForSync(ctx.tenantId, since),
    checklists.listActive(ctx.tenantId),
    callbacks.listForSync(ctx, since),
    defects.listForSync(ctx, since),
    repairJobsModule.listForSync(ctx),
  ])
  const settings = tenant.settings
  const me = users.find((u) => u.id === ctx.userId)

  const buildingDtos: SyncBuildingDto[] = buildingRows.map((b) => ({
    id: b.id,
    addressText: b.addressText,
    entrance: (b.address as { entrance?: string | null })?.entrance ?? null,
    lat: b.lat,
    lng: b.lng,
    customerName: b.customer?.name ?? null,
    accessNotes: b.accessNotes,
    updatedAt: b.updatedAt.toISOString(),
    deletedAt: b.deletedAt ? b.deletedAt.toISOString() : null,
  }))
  const elevatorDtos: SyncElevatorDto[] = elevatorRows.map((e) => {
    const next = toDateOnly(e.nextCheckDueAt)
    return {
      id: e.id,
      buildingId: e.buildingId,
      internalNo: e.internalNo,
      regNo: e.regNo,
      driveType: e.driveType,
      doorType: e.doorType,
      goodsOnly: e.goodsOnly,
      stops: e.stops,
      status: e.status,
      stopReason: e.stopReason,
      lastCheckAt: toDateOnly(e.lastCheckAt),
      nextCheckDueAt: next,
      dueState: dueState(next, e.status, today),
      notes: e.notes,
      updatedAt: e.updatedAt.toISOString(),
      deletedAt: e.deletedAt ? e.deletedAt.toISOString() : null,
    }
  })
  const contactDtos: SyncContactDto[] = contactRows.map((c) => ({
    id: c.id,
    buildingId: c.buildingId,
    name: c.name,
    role: c.role,
    phone: c.phone,
    isPrimary: c.isPrimary,
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
  }))
  // Open work: computed from the full elevator list (not the delta), whole tenant, full replace.
  const allElevators = since ? await elevators.listAllForSync(ctx.tenantId, null) : elevatorRows
  const jobs: SyncJobDto[] = []
  for (const e of allElevators) {
    if (e.deletedAt || e.status !== 'active') continue
    const next = toDateOnly(e.nextCheckDueAt)
    if (!next) continue
    const state =
      next < today ? 'overdue' : next === today ? 'today' : next === tomorrow ? 'tomorrow' : null
    if (!state) continue
    jobs.push({
      elevatorId: e.id,
      buildingId: e.buildingId,
      dueAt: next,
      state,
      daysOverdue:
        state === 'overdue' ? Math.round((Date.parse(today) - Date.parse(next)) / 86_400_000) : 0,
    })
  }
  const visitsSince = since ?? new Date(now.getTime() - FIRST_PULL_VISIT_DAYS * 86_400_000)
  const visitDtos = await visits.listSince(ctx.tenantId, visitsSince)
  const templateDtos: ChecklistTemplateDto[] = templates
  return {
    serverTime: now.toISOString(),
    since: since ? since.toISOString() : null,
    watermark: now.toISOString(),
    full: !since,
    me: { id: ctx.userId, name: me?.name ?? '', role: ctx.role },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      emergencyPhone: tenant.emergencyPhone,
      settings: {
        checkIntervalDays: settings.checkIntervalDays,
        callbackSlaMinutes: settings.callbackSlaMinutes,
        defectFollowUpDays: settings.defectFollowUpDays,
        minTechnicians: settings.minTechnicians,
      },
      features: { gpsCapture: tenant.features.gpsCapture },
    },
    users: users
      .filter((u) => u.isActive)
      .map((u) => ({ id: u.id, name: u.name, role: u.role, isActive: u.isActive })),
    buildings: buildingDtos,
    elevators: elevatorDtos,
    contacts: contactDtos,
    checklistTemplates: templateDtos,
    defectCatalog: defects.catalog(ctx.locale),
    jobs,
    callbacks: openCallbacks,
    defects: openDefects,
    visits: visitDtos,
    repairJobs,
  }
}

syncRouter.post('/sync/push', idempotent({ required: true }), async (req, res) => {
  const ctx = ctxOf(req)
  noteVersion(req)
  const item = parseBody(syncPushItem, req)
  const key = req.header('idempotency-key')
  if (key !== item.id) throw new AppError(400, 'sync.idempotencyKeyMismatch')
  const now = clock.now()
  const result = await apply(ctx, item)
  if (++pushCounter % 200 === 0) void sweepIdempotencyKeys(ctx.tenantId)
  const body: SyncPushResultDto = {
    id: item.id,
    kind: item.kind,
    status: 'applied',
    serverTime: now.toISOString(),
    result,
  }
  res.status(200).json(body)
})

async function apply(ctx: Ctx, item: ReturnType<typeof syncPushItem.parse>) {
  switch (item.kind) {
    case 'visit.record':
      return visits.record(ctx, { ...item.payload, source: 'app', timestampSource: 'device' })
    case 'visit.amend': {
      const { visitId, ...rest } = item.payload
      return visits.amend(ctx, visitId, { ...rest, source: 'app', timestampSource: 'device' })
    }
    case 'callback.event': {
      const p = item.payload
      return callbacks.transition(callbacks.actorFromCtx(ctx, 'app'), p.callbackId, p.type, {
        at: p.at,
        notes: p.notes ?? null,
        clientOffsetMs: p.clientOffsetMs,
        timestampSource: p.timestampSource,
      })
    }
    case 'defect.record': {
      const { clientOffsetMs: _o, timestampSource: _s, ...rest } = item.payload
      return defects.record(ctx, rest)
    }
    case 'job.event': {
      const p = item.payload
      const time = {
        at: p.at,
        clientOffsetMs: p.clientOffsetMs,
        timestampSource: p.timestampSource,
      }
      if (p.type === 'start')
        return repairJobsModule.start(ctx, p.jobId, { ...time, notes: p.notes ?? null }, 'app')
      if (p.type === 'note')
        return repairJobsModule.addNote(ctx, p.jobId, { ...time, notes: p.notes ?? '' }, 'app')
      return repairJobsModule.complete(
        ctx,
        p.jobId,
        {
          ...time,
          startedAt: p.startedAt,
          notes: p.notes ?? null,
          partsUsed: p.partsUsed ?? null,
          visitId: p.visitId,
          attachments: p.attachments,
          createVisit: true,
        },
        'app',
      )
    }
  }
}
