import { z } from 'zod'
import { isoDate, isoDateTime, nullableText, uuid } from './common.js'

/**
 * Step 9: zones (Райони) as tenant data, technician pairs (екипи) and the day plan (План за деня).
 * A zone is a GeoJSON Polygon drawn on the map and/or a list of district names; buildings are
 * assigned by point-in-polygon, then by district, else the default zone. The day plan is one row
 * per (date, pair) with an ordered JSONB list of stops built from what is due that day, ordered
 * nearest-neighbour from the tenant's base address (no routing engine).
 */

// ---- Zones -----------------------------------------------------------------------------------

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

/** GeoJSON Polygon geometry; only the first (outer) ring is used, holes are ignored. */
export const geoJsonPolygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(lngLat).min(4)).min(1),
})
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygon>

export const colourHex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: 'validation.colour' })

export const createZoneBody = z.object({
  name: z.string().trim().min(1).max(80),
  colour: colourHex.default('#2563eb'),
  polygon: geoJsonPolygon.nullable().optional(),
  districts: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  position: z.number().int().min(0).max(1000).optional(),
})
export type CreateZoneBody = z.infer<typeof createZoneBody>

export const updateZoneBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  colour: colourHex.optional(),
  polygon: geoJsonPolygon.nullable().optional(),
  districts: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
})
export type UpdateZoneBody = z.infer<typeof updateZoneBody>

export interface ZoneDto {
  id: string
  name: string
  colour: string
  polygon: GeoJsonPolygon | null
  districts: string[]
  position: number
  isDefault: boolean
  active: boolean
  /** Buildings currently in the zone (auto + manual). */
  buildingCount: number
  createdAt: string
  updatedAt: string
}

export interface ZoneRecomputeResultDto {
  /** Buildings whose zone changed. */
  changed: number
  /** Buildings looked at (non-manual, not archived). */
  total: number
}

// ---- Technician pairs ------------------------------------------------------------------------

export const createTechnicianPairBody = z.object({
  name: z.string().trim().min(1).max(80),
  /** One to three technicians; the two-technician rule lives in settings.minTechnicians. */
  userIds: z.array(uuid).min(1).max(3),
  vehicle: nullableText(80),
  defaultZoneId: uuid.nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
})
export type CreateTechnicianPairBody = z.infer<typeof createTechnicianPairBody>

export const updateTechnicianPairBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  userIds: z.array(uuid).min(1).max(3).optional(),
  vehicle: nullableText(80),
  defaultZoneId: uuid.nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
})
export type UpdateTechnicianPairBody = z.infer<typeof updateTechnicianPairBody>

export interface TechnicianPairDto {
  id: string
  name: string
  userIds: string[]
  /** Resolved names in the same order as userIds. */
  userNames: string[]
  vehicle: string | null
  defaultZoneId: string | null
  position: number
  active: boolean
  createdAt: string
  updatedAt: string
}

// ---- Day plans -------------------------------------------------------------------------------

export const PlanStopKind = z.enum(['check', 'callback', 'job', 'inspection'])
export type PlanStopKind = z.infer<typeof PlanStopKind>

export const PlanStopStatus = z.enum(['planned', 'done', 'skipped'])
export type PlanStopStatus = z.infer<typeof PlanStopStatus>

export const DayPlanStatus = z.enum(['draft', 'published'])
export type DayPlanStatus = z.infer<typeof DayPlanStatus>

/** What is stored in `day_plan.stops` (JSONB); display fields are resolved on read. */
export const planStop = z.object({
  /** Stable id of the stop inside the plan (uuid); the phone reports completion against it. */
  id: uuid,
  kind: PlanStopKind,
  /** check: elevatorId · callback: callbackId · job: jobId · inspection: inspectionId. */
  refId: uuid,
  elevatorId: uuid,
  buildingId: uuid,
  order: z.number().int().min(0),
  plannedAt: isoDateTime.nullable().optional(),
  status: PlanStopStatus.default('planned'),
  completedAt: isoDateTime.nullable().optional(),
  /** Added or moved by hand (kept through regeneration of a locked plan). */
  manual: z.boolean().optional(),
  notes: nullableText(500),
})
export type PlanStop = z.infer<typeof planStop>

/** A stop as the office / the phone sees it: the stored stop plus what to show and where to go. */
export interface PlanStopDto extends PlanStop {
  buildingAddressText: string
  lat: number | null
  lng: number | null
  elevatorInternalNo: string
  elevatorRegNo: string | null
  customerName: string | null
  contact: { name: string; phone: string | null } | null
  /** Short label of the reason (e.g. "просрочена 3 дни", the job title, the callback description). */
  label: string
  /** Sequence-based ETA (base + avgStopMinutes per stop + legs at avgSpeedKmh), ISO date-time. */
  eta: string | null
  /** Straight-line km from the previous stop (or the base). */
  legKm: number
}

export interface DayPlanDto {
  id: string
  date: string
  pairId: string | null
  pairName: string | null
  userIds: string[]
  userNames: string[]
  zoneId: string | null
  status: DayPlanStatus
  locked: boolean
  lockedAt: string | null
  publishedAt: string | null
  generatedAt: string | null
  start: { lat: number; lng: number } | null
  stops: PlanStopDto[]
  totals: { stops: number; elevators: number; done: number; estKm: number }
  notes: string | null
  updatedAt: string
}

/** Something due on the day that no plan carries yet. */
export interface UnplannedStopDto {
  kind: PlanStopKind
  refId: string
  elevatorId: string
  buildingId: string
  buildingAddressText: string
  lat: number | null
  lng: number | null
  elevatorInternalNo: string
  label: string
  zoneId: string | null
  plannedAt: string | null
}

export interface DayBoardDto {
  date: string
  zoneId: string | null
  plans: DayPlanDto[]
  unplanned: UnplannedStopDto[]
  totals: { stops: number; elevators: number; estKm: number; plans: number; published: number }
}

export const dayBoardQuery = z.object({
  date: isoDate.optional(),
  zoneId: uuid.optional(),
})
export type DayBoardQuery = z.infer<typeof dayBoardQuery>

export const generateDayPlansBody = z.object({
  date: isoDate,
  zoneId: uuid.nullable().optional(),
  /** Restrict to these pairs (default: every active pair, filtered by defaultZoneId when a zone is given). */
  pairIds: z.array(uuid).max(50).optional(),
})
export type GenerateDayPlansBody = z.infer<typeof generateDayPlansBody>

export interface GenerateDayPlansResultDto {
  board: DayBoardDto
  /** Plans created / regenerated / left alone because locked. */
  created: number
  regenerated: number
  keptLocked: number
}

/** PATCH /day-plans/:id - the whole ordered stop list (reorder / add / remove) and notes. */
export const updateDayPlanBody = z.object({
  stops: z
    .array(
      planStop.partial({ id: true, status: true, order: true }).extend({
        /** A stop copied from another plan or from the unplanned list keeps its id when given. */
        id: uuid.optional(),
      }),
    )
    .max(200)
    .optional(),
  notes: nullableText(2000),
})
export type UpdateDayPlanBody = z.infer<typeof updateDayPlanBody>

export const moveStopBody = z.object({
  stopId: uuid,
  toPlanId: uuid,
  /** Position in the target plan (default: last). */
  order: z.number().int().min(0).optional(),
})
export type MoveStopBody = z.infer<typeof moveStopBody>

/** POST /day-plans/:id/move-stop - both plans after the move. */
export interface MoveStopResultDto {
  from: DayPlanDto
  to: DayPlanDto
}

/** POST /day-plans/publish - how many plans were newly published and the board of the day. */
export interface PublishDayPlansResultDto {
  published: number
  board: DayBoardDto
}

export const publishDayPlansBody = z.object({
  date: isoDate,
  zoneId: uuid.nullable().optional(),
  planIds: z.array(uuid).max(50).optional(),
})
export type PublishDayPlansBody = z.infer<typeof publishDayPlansBody>

export const setStopStatusBody = z.object({
  status: PlanStopStatus,
  at: isoDateTime.optional(),
  notes: nullableText(500),
})
export type SetStopStatusBody = z.infer<typeof setStopStatusBody>

export const dayPlansMineQuery = z.object({
  date: isoDate.optional(),
})

/** Sync push kind `plan.stop` (technician app): a stop of my published plan is done / skipped. */
export const planStopEventPayload = z.object({
  planId: uuid,
  stopId: uuid,
  status: z.enum(['done', 'skipped']),
  at: isoDateTime,
  clientOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).default(0),
  // Same values as sync.TimestampSource (not imported: sync.ts imports this file).
  timestampSource: z.enum(['device', 'server', 'manual']).default('device'),
  notes: nullableText(500),
})
export type PlanStopEventPayload = z.infer<typeof planStopEventPayload>
