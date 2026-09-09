import { z } from 'zod'
import { isoDate, isoDateTime, listQuery, nullableText, patchOf, uuid } from './common.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const InspectionKind = z.enum(['periodic', 'after_repair', 'after_stop', 'other'])
export type InspectionKind = z.infer<typeof InspectionKind>

export const InspectionResult = z.enum(['passed', 'passed_with_defects', 'failed', 'pending'])
export type InspectionResult = z.infer<typeof InspectionResult>

export const inspectionDefect = z.object({
  text: z.string().trim().min(1).max(500),
  deadline: isoDate.nullable().optional(),
  closed: z.boolean().default(false),
})
export type InspectionDefectInput = z.infer<typeof inspectionDefect>

export const createInspectionBody = z.object({
  elevatorId: uuid,
  kind: InspectionKind.default('periodic'),
  requestedAt: isoDate.nullable().optional(),
  scheduledAt: isoDate.nullable().optional(),
  performedAt: isoDate.nullable().optional(),
  result: InspectionResult.default('pending'),
  inspectionBody: nullableText(200),
  /** Explicit next due date; computed from performedAt + interval when omitted (unless failed). */
  nextDueAt: isoDate.nullable().optional(),
  notes: nullableText(4000),
  defects: z.array(inspectionDefect).max(50).default([]),
})
export type CreateInspectionBody = z.infer<typeof createInspectionBody>

export const updateInspectionBody = patchOf(createInspectionBody.omit({ elevatorId: true }))
export type UpdateInspectionBody = z.infer<typeof updateInspectionBody>

export interface InspectionDefectDto {
  text: string
  deadline: string | null
  closed: boolean
}

export interface InspectionDto {
  id: string
  elevatorId: string
  elevatorInternalNo: string
  buildingId: string
  buildingAddressText: string
  kind: InspectionKind
  requestedAt: string | null
  scheduledAt: string | null
  performedAt: string | null
  result: InspectionResult
  inspectionBody: string | null
  nextDueAt: string | null
  notes: string | null
  defects: InspectionDefectDto[]
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export const inspectionListQuery = listQuery.extend({
  elevatorId: uuid.optional(),
  buildingId: uuid.optional(),
  result: InspectionResult.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})
export type InspectionListQuery = z.infer<typeof inspectionListQuery>

export const elevatorInspectionsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})

export const createAlarmTestBody = z.object({
  testedAt: isoDateTime.optional(),
  ok: z.boolean().default(true),
  notes: nullableText(2000),
})
export type CreateAlarmTestBody = z.infer<typeof createAlarmTestBody>

export interface AlarmTestDto {
  id: string
  elevatorId: string
  testedAt: string
  ok: boolean
  notes: string | null
  byUserId: string | null
  byUserName: string | null
  createdAt: string
}

// ---- Merged calendar ("Срокове") ---------------------------------------------------------------

export const CalendarItemKind = z.enum([
  'inspection_due',
  'check_overdue',
  'defect_follow_up',
  'callback_sla',
  'alarm_test_due',
  'job_approval',
])
export type CalendarItemKind = z.infer<typeof CalendarItemKind>

export const CalendarSeverity = z.enum(['overdue', 'due', 'upcoming'])
export type CalendarSeverity = z.infer<typeof CalendarSeverity>

export interface CalendarItemDto {
  /** `${kind}:${refId}` */
  id: string
  kind: CalendarItemKind
  refType: 'elevator' | 'defect' | 'callback' | 'inspection' | 'job'
  refId: string
  elevatorId: string
  elevatorInternalNo: string
  buildingId: string
  buildingAddressText: string
  /** YYYY-MM-DD */
  dueAt: string
  /** Days from today (negative = overdue). */
  inDays: number
  severity: CalendarSeverity
  /** Short, already localised description (server-side t()). */
  title: string
}

export const calendarQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Comma-separated kinds; all when omitted. */
  kinds: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter((s): s is CalendarItemKind =>
              CalendarItemKind.options.includes(s as CalendarItemKind),
            )
        : undefined,
    ),
  /** Include overdue items regardless of `from` (default true). */
  includeOverdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
})
export type CalendarQuery = z.infer<typeof calendarQuery>

export interface CalendarDto {
  today: string
  from: string
  to: string
  items: CalendarItemDto[]
  counts: Record<CalendarItemKind, number> & { overdue: number; total: number }
}
