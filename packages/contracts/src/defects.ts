import { z } from 'zod'
import { isoDate, isoDateTime, listQuery, nullableText, uuid } from './common.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const DefectStatus = z.enum([
  'open',
  'notified',
  'awaiting_approval',
  'scheduled',
  'resolved',
])
export type DefectStatus = z.infer<typeof DefectStatus>

export const DefectSource = z.enum(['visit', 'callback', 'office'])
export type DefectSource = z.infer<typeof DefectSource>

export const DefectSeverity = z.enum(['low', 'medium', 'high'])
export type DefectSeverity = z.infer<typeof DefectSeverity>

/** Catalogue codes are "1".."17" or "other" (packages/domain-data/defects/art10.v1.json). */
export const defectCatalogCode = z
  .string()
  .trim()
  .regex(/^([1-9]|1[0-7]|other)$/, { message: 'validation.invalidValue' })

export const createDefectBody = z.object({
  elevatorId: uuid,
  catalogCode: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    defectCatalogCode.nullable().optional(),
  ),
  /** Required for "other" / no catalogue code; defaults to the catalogue label otherwise. */
  description: nullableText(2000),
  severity: DefectSeverity.default('medium'),
  /** Defaults to the catalogue item's flag (every numbered item stops the lift). */
  stopLift: z.boolean().optional(),
  recordedAt: isoDateTime.optional(),
  sourceType: DefectSource.default('office'),
  sourceId: uuid.nullable().optional(),
  notes: nullableText(4000),
})
export type CreateDefectBody = z.infer<typeof createDefectBody>

export const updateDefectBody = z.object({
  status: DefectStatus.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  severity: DefectSeverity.optional(),
  notes: nullableText(4000),
  /** Explicit dates for paper backfill; the status transition sets them to now otherwise. */
  noticeSentAt: isoDateTime.nullable().optional(),
  customerRequestedAt: isoDateTime.nullable().optional(),
  resolvedAt: isoDateTime.optional(),
  resolvedVisitId: uuid.nullable().optional(),
})
export type UpdateDefectBody = z.infer<typeof updateDefectBody>

export interface DefectDto {
  id: string
  elevatorId: string
  elevatorInternalNo: string
  buildingId: string
  buildingAddressText: string
  catalogCode: string | null
  /** "т. 7" for catalogue items, null for free text. */
  catalogRef: string | null
  description: string
  severity: DefectSeverity
  stopLift: boolean
  status: DefectStatus
  recordedAt: string
  sourceType: DefectSource
  sourceId: string | null
  noticeSentAt: string | null
  customerRequestedAt: string | null
  followUpDueAt: string
  /** Days until the follow-up date (negative = overdue). */
  followUpInDays: number
  resolvedAt: string | null
  resolvedVisitId: string | null
  notes: string | null
  createdByUserId: string | null
  createdAt: string
}

const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional()

export const defectListQuery = listQuery.extend({
  status: DefectStatus.optional(),
  open: boolQuery,
  elevatorId: uuid.optional(),
  buildingId: uuid.optional(),
  stopLift: boolQuery,
  /** Open defects whose followUpDueAt is on or before today (or `to`). */
  followUpDue: boolQuery,
  to: isoDate.optional(),
})
export type DefectListQuery = z.infer<typeof defectListQuery>

export const elevatorDefectsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})

export interface DefectCatalogItemDto {
  code: string
  label: string
  stopLift: boolean
  ref: string | null
}

export interface DefectsSummaryDto {
  open: number
  stopLift: number
  awaitingApproval: number
  followUpDue: number
}
