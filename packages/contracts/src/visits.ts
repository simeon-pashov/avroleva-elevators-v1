import { z } from 'zod'
import { isoDate, isoDateTime, listQuery, nullableText, patchOf, uuid } from './common.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const VisitKind = z.enum([
  'functional_check',
  'technical_maintenance',
  'repair',
  'callback',
  'other',
])
export type VisitKind = z.infer<typeof VisitKind>

export const VisitSource = z.enum(['office', 'paper', 'app'])
export type VisitSource = z.infer<typeof VisitSource>

/** Kinds that count as "the periodic check was done" and move elevator.lastCheckAt. */
export const CHECK_VISIT_KINDS: readonly VisitKind[] = ['functional_check', 'technical_maintenance']

export const visitTechnician = z
  .object({
    userId: uuid.nullable().optional(),
    /** Free-text name (paper entry); required when no userId is given. */
    name: nullableText(120),
  })
  .refine((v) => v.userId || v.name, {
    message: 'validation.technicianNeedsNameOrUser',
    path: ['name'],
  })
export type VisitTechnicianInput = z.infer<typeof visitTechnician>

export const createVisitBody = z.object({
  /** Client-generated UUID (idempotency key: a repeated POST with the same id returns the same visit). */
  id: uuid.optional(),
  elevatorId: uuid,
  kind: VisitKind.default('functional_check'),
  startedAt: isoDateTime,
  endedAt: isoDateTime.nullable().optional(),
  technicians: z.array(visitTechnician).min(1).max(4),
  notes: nullableText(4000),
  source: VisitSource.default('office'),
})
export type CreateVisitBody = z.infer<typeof createVisitBody>

/** Visits are append-only: an amendment creates a new visit that supersedes the old one. */
export const amendVisitBody = patchOf(createVisitBody.omit({ id: true, elevatorId: true }))
export type AmendVisitBody = z.infer<typeof amendVisitBody>

export interface VisitTechnicianDto {
  userId: string | null
  name: string
}

export interface VisitDto {
  id: string
  elevatorId: string
  elevatorInternalNo?: string
  buildingId: string
  buildingAddressText?: string
  kind: VisitKind
  startedAt: string
  endedAt: string | null
  technicians: VisitTechnicianDto[]
  notes: string | null
  source: VisitSource
  qualityFlags: string[]
  createdByUserId: string | null
  supersedesVisitId: string | null
  supersededAt: string | null
  createdAt: string
}

export const visitListQuery = listQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  elevatorId: uuid.optional(),
  buildingId: uuid.optional(),
  kind: VisitKind.optional(),
})
export type VisitListQuery = z.infer<typeof visitListQuery>

export const elevatorVisitsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})
