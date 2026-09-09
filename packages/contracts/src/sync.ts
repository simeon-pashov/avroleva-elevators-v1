import { z } from 'zod'
import { isoDateTime, nullableText, uuid } from './common.js'
import type { DoorType, DriveType, ElevatorStatus } from './enums.js'
import { amendVisitBody, createVisitBody } from './visits.js'
import { createDefectBody } from './defects.js'
import { jobEventPayload } from './jobs.js'
import type { JobDto } from './jobs.js'
import type { CallbackDto } from './callbacks.js'
import type { DefectCatalogItemDto, DefectDto } from './defects.js'
import type { ChecklistTemplateDto } from './checklists.js'
import type { DueState } from './maintenance.js'
import type { TenantFeatures, TenantSettings } from './tenancy.js'
import type { VisitDto } from './visits.js'

/**
 * Sync protocol of the technician app (ARCHITECTURE section 4). Pull = changed rows since a
 * watermark (+ tombstones) and the server clock; push = one outbox item per request under an
 * Idempotency-Key. `schemaVersion` on every item lets the server upcast old phones (A9).
 */
export const SYNC_SCHEMA_VERSION = 1

/** Where a timestamp came from (A13). Device = the phone's clock, with its measured offset. */
export const TimestampSource = z.enum(['device', 'server', 'manual'])
export type TimestampSource = z.infer<typeof TimestampSource>

export const syncPullQuery = z.object({
  /** Watermark of the previous pull (serverTime of that response); absent = everything. */
  since: isoDateTime.optional(),
})
export type SyncPullQuery = z.infer<typeof syncPullQuery>

export interface SyncBuildingDto {
  id: string
  addressText: string
  entrance: string | null
  lat: number | null
  lng: number | null
  customerName: string | null
  accessNotes: string | null
  updatedAt: string
  deletedAt: string | null
}

export interface SyncElevatorDto {
  id: string
  buildingId: string
  internalNo: string
  regNo: string | null
  driveType: DriveType
  doorType: DoorType
  goodsOnly: boolean
  stops: number
  status: ElevatorStatus
  stopReason: string | null
  lastCheckAt: string | null
  nextCheckDueAt: string | null
  dueState: DueState
  notes: string | null
  updatedAt: string
  deletedAt: string | null
}

/** Name + phone only (house manager and other building contacts); no e-mail, no notes. */
export interface SyncContactDto {
  id: string
  buildingId: string | null
  name: string
  role: string
  phone: string | null
  isPrimary: boolean
  updatedAt: string
  deletedAt: string | null
}

export interface SyncUserDto {
  id: string
  name: string
  role: string
  isActive: boolean
}

/** Open work for the technician: elevators due (overdue / today / tomorrow). Full replace. */
export interface SyncJobDto {
  elevatorId: string
  buildingId: string
  dueAt: string
  state: 'overdue' | 'today' | 'tomorrow'
  daysOverdue: number
}

export interface SyncPullDto {
  serverTime: string
  since: string | null
  /** Watermark to send as `since` next time (= serverTime). */
  watermark: string
  full: boolean
  me: { id: string; name: string; role: string }
  tenant: {
    id: string
    name: string
    emergencyPhone: string
    settings: Pick<
      TenantSettings,
      'checkIntervalDays' | 'callbackSlaMinutes' | 'defectFollowUpDays' | 'minTechnicians'
    >
    features: Pick<TenantFeatures, 'gpsCapture'>
  }
  users: SyncUserDto[]
  buildings: SyncBuildingDto[]
  elevators: SyncElevatorDto[]
  contacts: SyncContactDto[]
  checklistTemplates: ChecklistTemplateDto[]
  defectCatalog: DefectCatalogItemDto[]
  jobs: SyncJobDto[]
  /** Open callbacks assigned to me (or unassigned) plus any changed since the watermark. */
  callbacks: CallbackDto[]
  /** Open defects plus any changed since the watermark (resolved ones arrive as tombstones). */
  defects: DefectDto[]
  /** Visits recorded since the watermark (first pull: last 90 days). */
  visits: VisitDto[]
  /** Repair jobs assigned to me that are approved / scheduled / in progress. Full replace. */
  repairJobs: JobDto[]
}

// ---- push ------------------------------------------------------------------------------------

const deviceTime = {
  at: isoDateTime,
  clientOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).default(0),
  timestampSource: TimestampSource.default('device'),
}

export const visitRecordPayload = createVisitBody.extend({ id: uuid })
export type VisitRecordPayload = z.infer<typeof visitRecordPayload>

export const visitAmendPayload = amendVisitBody.extend({ visitId: uuid })
export type VisitAmendPayload = z.infer<typeof visitAmendPayload>

export const callbackEventPayload = z.object({
  callbackId: uuid,
  type: z.enum(['on_site', 'released', 'restored']),
  ...deviceTime,
  notes: nullableText(2000),
})
export type CallbackEventPayload = z.infer<typeof callbackEventPayload>

export const defectRecordPayload = createDefectBody.extend({
  id: uuid,
  clientOffsetMs: deviceTime.clientOffsetMs,
  timestampSource: deviceTime.timestampSource,
})
export type DefectRecordPayload = z.infer<typeof defectRecordPayload>

const item = <K extends string, P extends z.ZodTypeAny>(kind: K, payload: P) =>
  z.object({
    id: uuid,
    kind: z.literal(kind),
    schemaVersion: z.number().int().min(1).max(SYNC_SCHEMA_VERSION).default(1),
    /** When the item was created on the phone (device clock). */
    createdAt: isoDateTime.optional(),
    payload,
  })

export const syncPushItem = z.discriminatedUnion('kind', [
  item('visit.record', visitRecordPayload),
  item('visit.amend', visitAmendPayload),
  item('callback.event', callbackEventPayload),
  item('defect.record', defectRecordPayload),
  item('job.event', jobEventPayload),
])
export type SyncPushItem = z.infer<typeof syncPushItem>
export type SyncPushKind = SyncPushItem['kind']

export interface SyncPushResultDto {
  id: string
  kind: SyncPushKind
  /** applied = processed now; replayed = stored response of an earlier identical request. */
  status: 'applied' | 'replayed'
  serverTime: string
  result: VisitDto | CallbackDto | DefectDto | JobDto
}

export const IDEMPOTENCY_HEADER = 'idempotency-key'
export const IDEMPOTENCY_TTL_DAYS = 7
export const MIN_CLIENT_VERSION_HEADER = 'x-min-client-version'
export const CLIENT_VERSION_HEADER = 'x-client-version'
export const CLIENT_HEADER = 'x-client'
