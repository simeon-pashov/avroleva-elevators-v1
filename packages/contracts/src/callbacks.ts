import { z } from 'zod'
import { isoDate, isoDateTime, listQuery, nullableText, phone, uuid } from './common.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const CallbackChannel = z.enum(['phone', 'public_page', 'office'])
export type CallbackChannel = z.infer<typeof CallbackChannel>

export const CallbackClassification = z.enum(['trapped_persons', 'breakdown', 'complaint', 'other'])
export type CallbackClassification = z.infer<typeof CallbackClassification>

export const CallbackStatus = z.enum([
  'open',
  'dispatched',
  'on_site',
  'released',
  'restored',
  'closed',
])
export type CallbackStatus = z.infer<typeof CallbackStatus>

/** Where a timestamp came from (ARCHITECTURE A13): the office UI, the technician app, the public page. */
export const EventSource = z.enum(['office', 'app', 'public'])
export type EventSource = z.infer<typeof EventSource>

export const SlaState = z.enum(['ok', 'at_risk', 'breached'])
export type SlaState = z.infer<typeof SlaState>

export const ChargeReason = z.enum(['misuse', 'vandalism', 'water', 'out_of_hours', 'other'])
export type ChargeReason = z.infer<typeof ChargeReason>

export const createCallbackBody = z.object({
  /** Client-generated UUID (idempotency for the technician app); optional from the office. */
  id: uuid.optional(),
  elevatorId: uuid,
  channel: CallbackChannel.default('phone'),
  callerName: nullableText(120),
  callerPhone: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    phone.nullable().optional(),
  ),
  classification: CallbackClassification.default('breakdown'),
  trappedCount: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.number().int().min(0).max(50).nullable(),
  ),
  description: z.string().trim().min(1).max(2000),
  /** When the call actually came in (defaults to now); never in the future. */
  receivedAt: isoDateTime.optional(),
  /** Office may dispatch on intake. Technicians are auto-assigned to themselves. */
  assignedUserId: uuid.nullable().optional(),
  notes: nullableText(4000),
})
export type CreateCallbackBody = z.infer<typeof createCallbackBody>

export const dispatchCallbackBody = z.object({ userId: uuid, at: isoDateTime.optional() })
export type DispatchCallbackBody = z.infer<typeof dispatchCallbackBody>

/** on-site / released / restored: optional explicit time (paper backfill), else now. */
export const callbackTransitionBody = z.object({
  at: isoDateTime.optional(),
  notes: nullableText(2000),
  /** Device provenance from the technician app; stored in the event's data (A13). */
  clientOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).optional(),
  timestampSource: z.enum(['device', 'server', 'manual']).optional(),
})
export type CallbackTransitionBody = z.infer<typeof callbackTransitionBody>

export const closeCallbackBody = z.object({
  at: isoDateTime.optional(),
  cause: z.string().trim().min(1).max(2000),
  actionTaken: z.string().trim().min(1).max(2000),
  chargeable: z.boolean().default(false),
  chargeReason: ChargeReason.nullable().optional(),
  notes: nullableText(4000),
  /** Skip the automatic close-out visit (e.g. resolved by phone, nobody went). */
  createVisit: z.boolean().default(true),
})
export type CloseCallbackBody = z.infer<typeof closeCallbackBody>

export interface CallbackEventDto {
  id: string
  type: string
  at: string
  receivedAt: string
  source: EventSource
  byUserId: string | null
  byUserName: string | null
  data: Record<string, unknown>
}

export interface CallbackDto {
  id: string
  elevatorId: string
  elevatorInternalNo: string
  buildingId: string
  buildingAddressText: string
  channel: CallbackChannel
  callerName: string | null
  callerPhone: string | null
  classification: CallbackClassification
  trappedCount: number | null
  description: string
  status: CallbackStatus
  receivedAt: string
  dispatchedAt: string | null
  onSiteAt: string | null
  releasedAt: string | null
  restoredAt: string | null
  closedAt: string | null
  assignedUserId: string | null
  assignedUserName: string | null
  cause: string | null
  actionTaken: string | null
  chargeable: boolean
  chargeReason: ChargeReason | null
  notes: string | null
  closeoutVisitId: string | null
  /** Snapshot of tenant.settings.callbackSlaMinutes when the callback was opened. */
  slaMinutes: number
  /** receivedAt -> onSiteAt, whole minutes; null until the technician is on site. */
  responseMinutes: number | null
  /** Minutes elapsed for the timer: to onSiteAt, else to closedAt, else to now. */
  elapsedMinutes: number
  slaState: SlaState
  source: EventSource
  createdAt: string
}

export interface CallbackDetailDto extends CallbackDto {
  events: CallbackEventDto[]
}

const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional()

export const callbackListQuery = listQuery.extend({
  status: CallbackStatus.optional(),
  /** Every status except closed. */
  open: boolQuery,
  from: isoDate.optional(),
  to: isoDate.optional(),
  elevatorId: uuid.optional(),
  buildingId: uuid.optional(),
  assignedUserId: uuid.optional(),
})
export type CallbackListQuery = z.infer<typeof callbackListQuery>

export const elevatorCallbacksQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})

/** Dashboard widget "Открити аварии". */
export interface CallbacksSummaryDto {
  open: number
  breached: number
  atRisk: number
  trapped: number
  oldest: CallbackDto | null
}
