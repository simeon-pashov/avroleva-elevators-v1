import type {
  DayBoardDto,
  DayPlanDto,
  GenerateDayPlansBody,
  GenerateDayPlansResultDto,
  MoveStopBody,
  MoveStopResultDto,
  PlanStop,
  PlanStopDto,
  PlanStopKind,
  PublishDayPlansBody,
  PublishDayPlansResultDto,
  SetStopStatusBody,
  TenantPlanningSettings,
  UnplannedStopDto,
  UpdateDayPlanBody,
} from '@avroleva/contracts'
import { planStop } from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'
import { actorOf, systemActorOf } from '../../../platform/http/ctx.js'
import { AppError, notFound } from '../../../platform/http/errors.js'
import { audit } from '../../../platform/audit.js'
import {
  addDays,
  clock,
  dateOnlyInSofia,
  fromDateOnly,
  toDateOnly,
  todayInSofia,
} from '../../../platform/clock.js'
import { events } from '../../../platform/events/bus.js'
import { newId } from '../../../platform/ids.js'
import type { Prisma } from '../../../generated/prisma/index.js'
import { getTenantSettings } from '../../tenancy/index.js'
import { elevators } from '../../registry/index.js'
import type { ElevatorDetailRow } from '../../registry/index.js'
import * as repo from '../repo/plans.js'
import type { PlanRow } from '../repo/plans.js'
import type { PairRow } from '../repo/pairs.js'
import * as pairs from './pairs.js'
import { planSources } from '../domain/ports.js'
import type { PlanSourceCallback, PlanSourceInspection, PlanSourceJob } from '../domain/ports.js'
import {
  chunkEvenly,
  dedupeStops,
  mergeRegeneration,
  pairIndexForUsers,
  renumber,
  stopKey,
} from '../domain/plan.js'
import {
  estKm,
  etaSequence,
  legsKm,
  orderNearestNeighbour,
  sofiaLocalToUtc,
} from '../domain/route.js'
import type { RoutePoint } from '../domain/route.js'
import { daysBetween } from '../domain/nextDue.js'

/**
 * Day plans (План за деня, step 9): one row per (date, technician pair) with an ordered JSONB
 * list of stops built from what is due that day - checks due or overdue, open callbacks,
 * repair jobs scheduled for the day, pending inspections - ordered nearest-neighbour from the
 * firm's base and split across the pairs. The office edits, locks and publishes; the phones pull
 * the published plans and report each stop done. Other L3 modules are read only through the
 * PlanSources port (domain/ports.ts, wired in wiring.ts).
 */
const actor = (ctx: Ctx) => (ctx.userId ? actorOf(ctx) : systemActorOf(ctx.tenantId))
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const PLANNED_CALLBACK_STATUSES = new Set(['open', 'dispatched'])
const PLANNED_JOB_STATUSES = new Set(['scheduled', 'in_progress'])

interface Candidate {
  kind: PlanStopKind
  refId: string
  elevatorId: string
  buildingId: string
  lat: number | null
  lng: number | null
  zoneId: string | null
  plannedAt: string | null
  assignedUserIds: string[]
}

/** Everything a day's plans refer to, loaded with a handful of batched reads. */
interface Sources {
  elevatorsById: Map<string, ElevatorDetailRow>
  callbacksById: Map<string, PlanSourceCallback>
  jobsById: Map<string, PlanSourceJob>
  inspectionsById: Map<string, PlanSourceInspection>
}

// ---- stops as data -------------------------------------------------------------------------------

export function parseStops(raw: unknown): PlanStop[] {
  const stops = planStop.array().parse(Array.isArray(raw) ? raw : [])
  return stops.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

const toJson = (stops: PlanStop[]) => stops as unknown as Prisma.InputJsonValue

function startOf(settings: TenantPlanningSettings): RoutePoint | null {
  return settings.baseLat != null && settings.baseLng != null
    ? { lat: settings.baseLat, lng: settings.baseLng }
    : null
}

function planStart(row: PlanRow, settings: TenantPlanningSettings): RoutePoint | null {
  return row.startLat != null && row.startLng != null
    ? { lat: row.startLat, lng: row.startLng }
    : startOf(settings)
}

function pointsOf(stops: PlanStop[], src: Sources) {
  return stops.map((s) => {
    const b = src.elevatorsById.get(s.elevatorId)?.building
    return { key: s.id, lat: b?.lat ?? null, lng: b?.lng ?? null }
  })
}

function estKmOf(start: RoutePoint | null, stops: PlanStop[], src: Sources): number {
  return estKm(legsKm(start, pointsOf(stops, src)))
}

async function load(tenantId: string, id: string): Promise<PlanRow> {
  const p = await repo.findPlan(tenantId, id)
  if (!p) throw notFound()
  return p
}

// ---- sources ---------------------------------------------------------------------------------------

function dayBounds(date: string): { from: Date; to: Date } {
  return { from: sofiaLocalToUtc(date, '00:00'), to: sofiaLocalToUtc(addDays(date, 1), '00:00') }
}

async function loadSources(
  tenantId: string,
  date: string,
  plans: Array<{ stops: unknown }>,
): Promise<Sources> {
  const stops = plans.flatMap((p) => parseStops(p.stops))
  const idsOf = (kind: PlanStopKind) => [
    ...new Set(stops.filter((s) => s.kind === kind).map((s) => s.refId)),
  ]
  const src = planSources()
  const [elevatorRows, callbacks, jobs, inspections] = await Promise.all([
    elevators.listForSchedule(tenantId),
    src.openCallbacks(tenantId),
    src.jobsForPlanning(tenantId, { ...dayBounds(date), ids: idsOf('job') }),
    src.scheduledInspections(tenantId),
  ])
  const out: Sources = {
    elevatorsById: new Map(elevatorRows.map((e) => [e.id, e])),
    callbacksById: new Map(callbacks.map((c) => [c.id, c])),
    jobsById: new Map(jobs.map((j) => [j.id, j])),
    inspectionsById: new Map(inspections.map((i) => [i.id, i])),
  }
  // Stops whose reference left the live lists (closed callback, performed inspection, scrapped
  // lift) are still shown: fetch the stragglers one by one - there are few.
  const missingElevators = [...new Set(stops.map((s) => s.elevatorId))].filter(
    (id) => !out.elevatorsById.has(id),
  )
  if (missingElevators.length > 0)
    for (const e of await elevators.findDetailByIds(tenantId, missingElevators))
      out.elevatorsById.set(e.id, e)
  for (const id of idsOf('callback')) {
    if (out.callbacksById.has(id)) continue
    const c = await src.callback(tenantId, id)
    if (c) out.callbacksById.set(id, c)
  }
  for (const id of idsOf('inspection')) {
    if (out.inspectionsById.has(id)) continue
    const i = await src.inspection(tenantId, id)
    if (i) out.inspectionsById.set(id, i)
  }
  return out
}

/**
 * What is due on `date`: checks with nextCheckDueAt <= date (overdue included), open callbacks,
 * repair jobs scheduled on the day, pending inspections scheduled on the day. Coordinates and
 * the zone come from the building; a zone filter keeps that zone's buildings only.
 */
function candidatesOf(src: Sources, date: string, zoneId: string | null): Candidate[] {
  const out: Candidate[] = []
  const push = (c: Omit<Candidate, 'lat' | 'lng' | 'zoneId'>) => {
    const b = src.elevatorsById.get(c.elevatorId)?.building
    const cand: Candidate = {
      ...c,
      lat: b?.lat ?? null,
      lng: b?.lng ?? null,
      zoneId: b?.zoneId ?? null,
    }
    if (zoneId && cand.zoneId !== zoneId) return
    out.push(cand)
  }
  for (const e of src.elevatorsById.values()) {
    if (e.status !== 'active' || e.deletedAt) continue
    const next = toDateOnly(e.nextCheckDueAt)
    if (!next || next > date) continue
    push({
      kind: 'check',
      refId: e.id,
      elevatorId: e.id,
      buildingId: e.buildingId,
      plannedAt: null,
      assignedUserIds: [],
    })
  }
  for (const c of src.callbacksById.values()) {
    if (!PLANNED_CALLBACK_STATUSES.has(c.status)) continue
    push({
      kind: 'callback',
      refId: c.id,
      elevatorId: c.elevatorId,
      buildingId: c.buildingId,
      plannedAt: null,
      assignedUserIds: c.assignedUserId ? [c.assignedUserId] : [],
    })
  }
  for (const j of src.jobsById.values()) {
    if (!PLANNED_JOB_STATUSES.has(j.status) || !j.scheduledAt) continue
    if (dateOnlyInSofia(j.scheduledAt) !== date) continue
    push({
      kind: 'job',
      refId: j.id,
      elevatorId: j.elevatorId,
      buildingId: j.buildingId,
      plannedAt: j.scheduledAt.toISOString(),
      assignedUserIds: j.assignedUserIds,
    })
  }
  for (const i of src.inspectionsById.values()) {
    if (i.result !== 'pending' || i.scheduledAt !== date) continue
    push({
      kind: 'inspection',
      refId: i.id,
      elevatorId: i.elevatorId,
      buildingId: i.buildingId,
      plannedAt: null,
      assignedUserIds: [],
    })
  }
  return dedupeStops(out)
}

/** Public for tests and the board: the candidates of a day (no plan involved). */
export async function buildCandidates(
  ctx: Ctx,
  date: string,
  zoneId: string | null = null,
): Promise<UnplannedStopDto[]> {
  const src = await loadSources(ctx.tenantId, date, [])
  return candidatesOf(src, date, zoneId).map((c) => toUnplannedDto(ctx, c, src, date))
}

function nnOrder(start: RoutePoint | null, items: Candidate[]): Candidate[] {
  const byKey = new Map(items.map((c) => [stopKey(c), c]))
  return orderNearestNeighbour(
    start,
    items.map((c) => ({ key: stopKey(c), lat: c.lat, lng: c.lng })),
  ).map((k) => byKey.get(k)!)
}

// ---- DTOs -------------------------------------------------------------------------------------------

function labelOf(ctx: Ctx, s: { kind: PlanStopKind; refId: string }, src: Sources, date: string) {
  switch (s.kind) {
    case 'check': {
      const next = toDateOnly(src.elevatorsById.get(s.refId)?.nextCheckDueAt ?? null)
      const overdue = next ? daysBetween(next, date) : 0
      return overdue > 0
        ? ctx.t('dayPlan.label.check', { count: overdue })
        : ctx.t('dayPlan.label.checkToday')
    }
    case 'callback':
      return src.callbacksById.get(s.refId)?.description ?? ctx.t('dayPlan.label.callback')
    case 'job':
      return src.jobsById.get(s.refId)?.title ?? ctx.t('dayPlan.label.job')
    case 'inspection':
      return ctx.t('dayPlan.label.inspection')
  }
}

function toStopDto(
  ctx: Ctx,
  s: PlanStop,
  src: Sources,
  date: string,
  eta: string | null,
  legKm: number,
): PlanStopDto {
  const e = src.elevatorsById.get(s.elevatorId)
  const b = e?.building
  const contact = b
    ? (b.contacts.find((c) => c.role === 'house_manager') ?? b.contacts[0] ?? null)
    : null
  return {
    ...s,
    plannedAt: s.plannedAt ?? null,
    completedAt: s.completedAt ?? null,
    manual: s.manual ?? false,
    notes: s.notes ?? null,
    buildingAddressText: b?.addressText ?? '',
    lat: b?.lat ?? null,
    lng: b?.lng ?? null,
    elevatorInternalNo: e?.internalNo ?? '',
    elevatorRegNo: e?.regNo ?? null,
    customerName: b?.customer?.name ?? null,
    contact: contact ? { name: contact.name, phone: contact.phone } : null,
    label: labelOf(ctx, s, src, date),
    eta,
    legKm,
  }
}

function toUnplannedDto(ctx: Ctx, c: Candidate, src: Sources, date: string): UnplannedStopDto {
  const e = src.elevatorsById.get(c.elevatorId)
  return {
    kind: c.kind,
    refId: c.refId,
    elevatorId: c.elevatorId,
    buildingId: c.buildingId,
    buildingAddressText: e?.building.addressText ?? '',
    lat: c.lat,
    lng: c.lng,
    elevatorInternalNo: e?.internalNo ?? '',
    label: labelOf(ctx, c, src, date),
    zoneId: c.zoneId,
    plannedAt: c.plannedAt,
  }
}

function toPlanDto(
  ctx: Ctx,
  row: PlanRow,
  src: Sources,
  settings: TenantPlanningSettings,
  names: Map<string, string>,
): DayPlanDto {
  const date = toDateOnly(row.date)!
  const stops = renumber(parseStops(row.stops))
  const start = planStart(row, settings)
  const legs = legsKm(start, pointsOf(stops, src))
  const etas = etaSequence(
    date,
    settings.dayStart,
    legs,
    settings.avgSpeedKmh,
    settings.avgStopMinutes,
  )
  const stopDtos = stops.map((s, i) => toStopDto(ctx, s, src, date, etas[i] ?? null, legs[i] ?? 0))
  return {
    id: row.id,
    date,
    pairId: row.pairId,
    pairName: row.pair?.name ?? null,
    userIds: row.userIds,
    userNames: row.userIds.map((id) => names.get(id) ?? '').filter(Boolean),
    zoneId: row.zoneId,
    status: row.status,
    locked: !!row.lockedAt,
    lockedAt: iso(row.lockedAt),
    publishedAt: iso(row.publishedAt),
    generatedAt: iso(row.generatedAt),
    start,
    stops: stopDtos,
    totals: {
      stops: stops.length,
      elevators: new Set(stops.map((s) => s.elevatorId)).size,
      done: stops.filter((s) => s.status === 'done').length,
      estKm: estKm(legs),
    },
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function toDtos(
  ctx: Ctx,
  rows: PlanRow[],
  src: Sources,
  settings: TenantPlanningSettings,
): Promise<DayPlanDto[]> {
  const names = await pairs.namesFor(
    ctx.tenantId,
    rows.flatMap((r) => r.userIds),
  )
  return rows.map((r) => toPlanDto(ctx, r, src, settings, names))
}

/** One plan as a DTO, with its day's sources loaded. */
async function dtoOf(ctx: Ctx, row: PlanRow): Promise<DayPlanDto> {
  const date = toDateOnly(row.date)!
  const [settings, src] = await Promise.all([
    getTenantSettings(ctx.tenantId),
    loadSources(ctx.tenantId, date, [row]),
  ])
  return (await toDtos(ctx, [row], src, settings.planning))[0]!
}

// ---- reads -------------------------------------------------------------------------------------------

export async function get(ctx: Ctx, id: string): Promise<DayPlanDto> {
  return dtoOf(ctx, await load(ctx.tenantId, id))
}

export async function board(
  ctx: Ctx,
  q: { date?: string; zoneId?: string | null },
): Promise<DayBoardDto> {
  return boardFor(ctx, q.date ?? todayInSofia(), q.zoneId ?? null)
}

async function boardFor(ctx: Ctx, date: string, zoneId: string | null): Promise<DayBoardDto> {
  const all = await repo.listForDate(ctx.tenantId, fromDateOnly(date)!)
  const [settings, src] = await Promise.all([
    getTenantSettings(ctx.tenantId),
    loadSources(ctx.tenantId, date, all),
  ])
  const shown = zoneId ? all.filter((p) => p.zoneId === zoneId || p.zoneId === null) : all
  const plans = await toDtos(ctx, shown, src, settings.planning)
  // Unplanned = due today and in no plan of the day (whatever zone that plan was made for).
  const planned = new Set(all.flatMap((p) => parseStops(p.stops).map(stopKey)))
  const unplanned = candidatesOf(src, date, zoneId)
    .filter((c) => !planned.has(stopKey(c)))
    .map((c) => toUnplannedDto(ctx, c, src, date))
  const elevatorIds = new Set(plans.flatMap((p) => p.stops.map((s) => s.elevatorId)))
  return {
    date,
    zoneId,
    plans,
    unplanned,
    totals: {
      stops: plans.reduce((n, p) => n + p.totals.stops, 0),
      elevators: elevatorIds.size,
      estKm: Math.round(plans.reduce((n, p) => n + p.totals.estKm, 0) * 10) / 10,
      plans: plans.length,
      published: plans.filter((p) => p.status === 'published').length,
    },
  }
}

/** Published plans of the given days that list the caller (technician app; `mine`, sync pull). */
export async function listMyPlans(ctx: Ctx, dates: string[]): Promise<DayPlanDto[]> {
  const rows = await repo.listPublishedForUser(
    ctx.tenantId,
    ctx.userId,
    dates.map((d) => fromDateOnly(d)!),
  )
  if (rows.length === 0) return []
  const settings = await getTenantSettings(ctx.tenantId)
  const out: DayPlanDto[] = []
  for (const date of dates) {
    const ofDay = rows.filter((r) => toDateOnly(r.date) === date)
    if (ofDay.length === 0) continue
    const src = await loadSources(ctx.tenantId, date, ofDay)
    out.push(...(await toDtos(ctx, ofDay, src, settings.planning)))
  }
  return out
}

export function mine(ctx: Ctx, date?: string): Promise<DayPlanDto[]> {
  return listMyPlans(ctx, [date ?? todayInSofia()])
}

// ---- generate ------------------------------------------------------------------------------------------

async function resolvePairs(tenantId: string, body: GenerateDayPlansBody): Promise<PairRow[]> {
  if (body.pairIds && body.pairIds.length > 0) {
    const rows = await pairs.findByIds(tenantId, body.pairIds)
    if (rows.length !== new Set(body.pairIds).size) throw notFound('dayPlan.pairNotFound')
    return rows
  }
  const active = await pairs.listActive(tenantId)
  if (body.zoneId) {
    const inZone = active.filter((p) => p.defaultZoneId === body.zoneId)
    if (inZone.length > 0) return inZone
  }
  return active
}

function toPlanStops(seq: Candidate[]): PlanStop[] {
  return seq.map((c, order) => ({
    id: newId(),
    kind: c.kind,
    refId: c.refId,
    elevatorId: c.elevatorId,
    buildingId: c.buildingId,
    order,
    plannedAt: c.plannedAt,
    status: 'planned' as const,
    completedAt: null,
    manual: false,
    notes: null,
  }))
}

/**
 * Builds or rebuilds the plans of a day: one per pair. Candidates already assigned to a
 * technician go to that technician's pair; the rest are ordered nearest-neighbour from the base
 * and split into contiguous chunks of equal size, one per pair, each re-ordered from the base.
 * Locked plans are left alone; unlocked ones are merged (done / manual stops kept).
 */
export async function generate(
  ctx: Ctx,
  body: GenerateDayPlansBody,
): Promise<GenerateDayPlansResultDto> {
  if (body.date < todayInSofia()) throw new AppError(400, 'dayPlan.dateInPast')
  const settings = (await getTenantSettings(ctx.tenantId)).planning
  const pairRows = await resolvePairs(ctx.tenantId, body)
  if (pairRows.length === 0) throw new AppError(409, 'dayPlan.noPairs')
  const date = fromDateOnly(body.date)!
  const zoneId = body.zoneId ?? null
  const existingPlans = await repo.listForDate(ctx.tenantId, date)
  const src = await loadSources(ctx.tenantId, body.date, existingPlans)
  const candidates = candidatesOf(src, body.date, zoneId)
  const start = startOf(settings)

  const perPair: Candidate[][] = pairRows.map(() => [])
  const rest: Candidate[] = []
  for (const c of candidates) {
    const idx = pairIndexForUsers(pairRows, c.assignedUserIds)
    if (idx >= 0) perPair[idx]!.push(c)
    else rest.push(c)
  }
  chunkEvenly(nnOrder(start, rest), pairRows.length).forEach((chunk, i) =>
    perPair[i]!.push(...chunk),
  )

  const counts = { created: 0, regenerated: 0, keptLocked: 0 }
  const now = clock.now()
  for (let i = 0; i < pairRows.length; i++) {
    const pair = pairRows[i]!
    const existing = existingPlans.find((p) => p.pairId === pair.id) ?? null
    if (existing?.lockedAt) {
      counts.keptLocked++
      continue
    }
    const merged = mergeRegeneration(
      existing ? parseStops(existing.stops) : null,
      false,
      toPlanStops(nnOrder(start, perPair[i]!)),
    )
    const data = {
      stops: toJson(merged),
      userIds: pair.userIds,
      zoneId: zoneId ?? pair.defaultZoneId ?? null,
      generatedAt: now,
      startLat: start?.lat ?? null,
      startLng: start?.lng ?? null,
      estKm: estKmOf(start, merged, src),
      updatedBy: ctx.userId || null,
    }
    if (existing) {
      await repo.updatePlan(ctx.tenantId, existing.id, data)
      counts.regenerated++
    } else {
      await repo.createPlan(ctx.tenantId, {
        date,
        pairId: pair.id,
        ...data,
        createdBy: ctx.userId || null,
      })
      counts.created++
    }
  }
  await audit(actor(ctx), {
    action: 'dayPlan.generate',
    entityType: 'day_plan',
    entityId: null,
    after: {
      date: body.date,
      zoneId,
      pairs: pairRows.length,
      candidates: candidates.length,
      ...counts,
    },
  })
  return { board: await boardFor(ctx, body.date, zoneId), ...counts }
}

// ---- office edits ----------------------------------------------------------------------------------------

type StopInput = NonNullable<UpdateDayPlanBody['stops']>[number]

/** Every refId must exist in the tenant; returns the authoritative elevator / building per stop. */
async function resolveRefs(
  tenantId: string,
  stops: Array<{ kind: PlanStopKind; refId: string }>,
): Promise<Map<string, { elevatorId: string; buildingId: string }>> {
  const out = new Map<string, { elevatorId: string; buildingId: string }>()
  const ids = (kind: PlanStopKind) => [
    ...new Set(stops.filter((s) => s.kind === kind).map((s) => s.refId)),
  ]
  const src = planSources()
  const checks = ids('check')
  if (checks.length > 0)
    for (const e of await elevators.findByIds(tenantId, checks))
      out.set(`check:${e.id}`, { elevatorId: e.id, buildingId: e.buildingId })
  const callbackIds = ids('callback')
  if (callbackIds.length > 0) {
    const open = new Map((await src.openCallbacks(tenantId)).map((c) => [c.id, c]))
    for (const id of callbackIds) {
      const c = open.get(id) ?? (await src.callback(tenantId, id))
      if (c) out.set(`callback:${id}`, { elevatorId: c.elevatorId, buildingId: c.buildingId })
    }
  }
  const jobIds = ids('job')
  if (jobIds.length > 0) {
    const now = clock.now()
    for (const j of await src.jobsForPlanning(tenantId, { from: now, to: now, ids: jobIds }))
      out.set(`job:${j.id}`, { elevatorId: j.elevatorId, buildingId: j.buildingId })
  }
  const inspectionIds = ids('inspection')
  if (inspectionIds.length > 0) {
    const scheduled = new Map((await src.scheduledInspections(tenantId)).map((i) => [i.id, i]))
    for (const id of inspectionIds) {
      const i = scheduled.get(id) ?? (await src.inspection(tenantId, id))
      if (i) out.set(`inspection:${id}`, { elevatorId: i.elevatorId, buildingId: i.buildingId })
    }
  }
  for (const s of stops) if (!out.has(stopKey(s))) throw notFound('dayPlan.refNotFound')
  return out
}

/**
 * PATCH: the whole ordered list (reorder / add / remove) and the notes. Stops new to the plan
 * are `manual`; a locked plan accepts edits (the lock protects against regeneration only).
 */
export async function update(ctx: Ctx, id: string, body: UpdateDayPlanBody): Promise<DayPlanDto> {
  const plan = await load(ctx.tenantId, id)
  const before = parseStops(plan.stops)
  let stops = before
  if (body.stops) {
    const existingById = new Map(before.map((s) => [s.id, s]))
    const refs = await resolveRefs(ctx.tenantId, body.stops)
    const next = body.stops.map((s: StopInput, i): PlanStop => {
      const ref = refs.get(stopKey(s))!
      const prior = s.id ? existingById.get(s.id) : undefined
      return {
        id: s.id ?? newId(),
        kind: s.kind,
        refId: s.refId,
        elevatorId: ref.elevatorId,
        buildingId: ref.buildingId,
        order: i,
        plannedAt: s.plannedAt !== undefined ? s.plannedAt : (prior?.plannedAt ?? null),
        status: s.status ?? prior?.status ?? 'planned',
        completedAt: s.completedAt !== undefined ? s.completedAt : (prior?.completedAt ?? null),
        manual: prior ? (s.manual ?? prior.manual ?? false) : true,
        notes: s.notes !== undefined ? s.notes : (prior?.notes ?? null),
      }
    })
    stops = renumber(dedupeStops(next))
  }
  const settings = (await getTenantSettings(ctx.tenantId)).planning
  const src = await loadSources(ctx.tenantId, toDateOnly(plan.date)!, [{ stops }])
  const updated = await repo.updatePlan(ctx.tenantId, id, {
    ...(body.stops
      ? { stops: toJson(stops), estKm: estKmOf(planStart(plan, settings), stops, src) }
      : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    updatedBy: ctx.userId || null,
  })
  await audit(actor(ctx), {
    action: 'dayPlan.update',
    entityType: 'day_plan',
    entityId: id,
    before: { stops: before.map(stopKey) },
    after: { stops: stops.map(stopKey), notes: updated.notes },
  })
  return (await toDtos(ctx, [updated], src, settings))[0]!
}

/** Moves one stop to another plan of the same day (or re-positions it inside the same plan). */
export async function moveStop(
  ctx: Ctx,
  id: string,
  body: MoveStopBody,
): Promise<MoveStopResultDto> {
  const from = await load(ctx.tenantId, id)
  const to = from.id === body.toPlanId ? from : await load(ctx.tenantId, body.toPlanId)
  if (toDateOnly(from.date) !== toDateOnly(to.date))
    throw new AppError(400, 'dayPlan.differentDate')
  const fromStops = parseStops(from.stops)
  const idx = fromStops.findIndex((s) => s.id === body.stopId)
  if (idx < 0) throw notFound('dayPlan.stopNotFound')
  const [stop] = fromStops.splice(idx, 1)
  const moved: PlanStop = { ...stop!, manual: true }
  const toStops = from.id === to.id ? fromStops : parseStops(to.stops)
  const key = stopKey(moved)
  const target = toStops.filter((s) => stopKey(s) !== key)
  const pos = Math.max(0, Math.min(body.order ?? target.length, target.length))
  target.splice(pos, 0, moved)
  const settings = (await getTenantSettings(ctx.tenantId)).planning
  const date = toDateOnly(from.date)!
  const src = await loadSources(ctx.tenantId, date, [from, to])
  const newFrom = renumber(from.id === to.id ? target : fromStops)
  const newTo = renumber(target)
  const savedTo = await repo.updatePlan(ctx.tenantId, to.id, {
    stops: toJson(newTo),
    estKm: estKmOf(planStart(to, settings), newTo, src),
    updatedBy: ctx.userId || null,
  })
  const savedFrom =
    from.id === to.id
      ? savedTo
      : await repo.updatePlan(ctx.tenantId, from.id, {
          stops: toJson(newFrom),
          estKm: estKmOf(planStart(from, settings), newFrom, src),
          updatedBy: ctx.userId || null,
        })
  await audit(actor(ctx), {
    action: 'dayPlan.moveStop',
    entityType: 'day_plan',
    entityId: from.id,
    after: {
      stopId: body.stopId,
      kind: moved.kind,
      refId: moved.refId,
      toPlanId: to.id,
      order: pos,
    },
  })
  const dtos = await toDtos(ctx, [savedFrom, savedTo], src, settings)
  return { from: dtos[0]!, to: dtos[1]! }
}

export async function setLocked(ctx: Ctx, id: string, locked: boolean): Promise<DayPlanDto> {
  const plan = await load(ctx.tenantId, id)
  const updated = await repo.updatePlan(ctx.tenantId, id, {
    lockedAt: locked ? (plan.lockedAt ?? clock.now()) : null,
    updatedBy: ctx.userId || null,
  })
  await audit(actor(ctx), {
    action: locked ? 'dayPlan.lock' : 'dayPlan.unlock',
    entityType: 'day_plan',
    entityId: id,
    after: { lockedAt: iso(updated.lockedAt) },
  })
  return dtoOf(ctx, updated)
}

/** Marks the plans of a day (or the listed ones) published and tells the world once per plan. */
export async function publish(
  ctx: Ctx,
  body: PublishDayPlansBody,
): Promise<PublishDayPlansResultDto> {
  const date = fromDateOnly(body.date)!
  const zoneId = body.zoneId ?? null
  let plans: PlanRow[]
  if (body.planIds && body.planIds.length > 0) {
    plans = await repo.findPlansByIds(ctx.tenantId, body.planIds)
    if (plans.length !== new Set(body.planIds).size) throw notFound()
    if (plans.some((p) => toDateOnly(p.date) !== body.date))
      throw new AppError(400, 'dayPlan.differentDate')
  } else {
    plans = await repo.listForDate(ctx.tenantId, date, zoneId)
  }
  const now = clock.now()
  let published = 0
  for (const p of plans) {
    if (p.status === 'published') continue
    await repo.updatePlan(ctx.tenantId, p.id, {
      status: 'published',
      publishedAt: now,
      updatedBy: ctx.userId || null,
    })
    await events.publish(ctx, {
      type: 'DayPlanPublished',
      aggregateType: 'day_plan',
      aggregateId: p.id,
      payload: {
        date: body.date,
        pairId: p.pairId,
        userIds: p.userIds,
        stops: parseStops(p.stops).length,
      },
    })
    published++
  }
  await audit(actor(ctx), {
    action: 'dayPlan.publish',
    entityType: 'day_plan',
    entityId: null,
    after: { date: body.date, zoneId, published, planIds: plans.map((p) => p.id) },
  })
  return { published, board: await boardFor(ctx, body.date, zoneId) }
}

// ---- stop status (office, technician app, sync push) -------------------------------------------------------

function parseAt(at: string | undefined, now: Date): Date {
  if (!at) return now
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'validation.invalidFormat')
  return d
}

/**
 * done / skipped / planned for one stop. Office roles always; a technician only on a plan that
 * lists them (404 otherwise - a foreign plan looks exactly like a missing one). Idempotent.
 */
export async function setStopStatus(
  ctx: Ctx,
  planId: string,
  stopId: string,
  body: SetStopStatusBody,
  source: 'office' | 'app' = 'office',
): Promise<DayPlanDto> {
  const plan = await load(ctx.tenantId, planId)
  if (ctx.role === 'technician' && !plan.userIds.includes(ctx.userId)) throw notFound()
  const stops = parseStops(plan.stops)
  const idx = stops.findIndex((s) => s.id === stopId)
  if (idx < 0) throw notFound('dayPlan.stopNotFound')
  const now = clock.now()
  const at = parseAt(body.at, now)
  const s = stops[idx]!
  stops[idx] = {
    ...s,
    status: body.status,
    completedAt: body.status === 'planned' ? null : at.toISOString(),
    notes: body.notes !== undefined ? body.notes : (s.notes ?? null),
  }
  const updated = await repo.updatePlan(ctx.tenantId, plan.id, {
    stops: toJson(stops),
    updatedBy: ctx.userId || null,
  })
  await audit(actor(ctx), {
    action: 'dayPlan.stopStatus',
    entityType: 'day_plan',
    entityId: plan.id,
    before: { stopId, status: s.status },
    after: { stopId, kind: s.kind, refId: s.refId, status: body.status, source },
  })
  return dtoOf(ctx, updated)
}

/**
 * Event subscriber entry (VisitRecorded / CallbackClosed / JobCompleted): the matching planned
 * stop of every PUBLISHED plan of that day flips to done. Returns the stops touched.
 */
export async function markStopDoneByRef(
  tenantId: string,
  kind: PlanStopKind,
  refId: string,
  at: Date,
): Promise<number> {
  const plans = await repo.listByStatusForDate(
    tenantId,
    fromDateOnly(dateOnlyInSofia(at))!,
    'published',
  )
  let n = 0
  for (const p of plans) {
    const stops = parseStops(p.stops)
    let touched = false
    for (const s of stops) {
      if (s.kind !== kind || s.refId !== refId || s.status !== 'planned') continue
      s.status = 'done'
      s.completedAt = at.toISOString()
      touched = true
      n++
    }
    if (touched) await repo.updatePlan(tenantId, p.id, { stops: toJson(stops) })
  }
  return n
}
