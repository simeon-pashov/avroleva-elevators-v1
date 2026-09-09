import { z } from 'zod'
import {
  isoDate,
  isoDateTime,
  listQuery,
  nullableDate,
  nullableText,
  patchOf,
  phone,
  uuid,
} from './common.js'
import type { EventSource } from './callbacks.js'
import { visitAttachmentLink } from './documents.js'
import type { VisitAttachmentLink } from './documents.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const JobKind = z.enum(['repair', 'modernisation', 'other'])
export type JobKind = z.infer<typeof JobKind>

export const JobOriginType = z.enum(['visit', 'callback', 'defect', 'office'])
export type JobOriginType = z.infer<typeof JobOriginType>

export const JobLineKind = z.enum(['labour', 'part', 'other'])
export type JobLineKind = z.infer<typeof JobLineKind>

/** How the building said "yes" to the quote (ARCHITECTURE A13-style provenance for approvals). */
export const ApprovalEvidenceKind = z.enum([
  'assembly_protocol',
  'email',
  'viber',
  'verbal',
  'manager_signature',
])
export type ApprovalEvidenceKind = z.infer<typeof ApprovalEvidenceKind>

/**
 * Job stages are DATA (system defaults in packages/domain-data/jobs/stages.v1.json, tenant
 * overrides through PUT /jobs/stages). These are the default codes; the UI renders whatever
 * GET /jobs/config returns and never hard-codes the list.
 */
export const DEFAULT_JOB_STAGES = [
  'draft',
  'quoted',
  'awaiting_approval',
  'approved',
  'scheduled',
  'in_progress',
  'done',
  'invoiced',
  'rejected',
  'cancelled',
] as const
export type DefaultJobStage = (typeof DEFAULT_JOB_STAGES)[number]

/** Stages in which the quote (lines) may still change. */
export const JOB_EDITABLE_STAGES: readonly string[] = ['draft', 'quoted', 'awaiting_approval']
/** Stages that count as "open work" for the technician app and the board. */
export const JOB_OPEN_STAGES: readonly string[] = [
  'draft',
  'quoted',
  'awaiting_approval',
  'approved',
  'scheduled',
  'in_progress',
  'done',
]

export const jobStageCode = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, { message: 'validation.invalidValue' })

export const approvalEvidence = z.object({
  kind: ApprovalEvidenceKind,
  /** Who approved on the building's side (house manager's name, assembly date...). */
  by: nullableText(200),
  note: nullableText(2000),
  /** When the approval was given; defaults to now. */
  at: isoDateTime.optional(),
  attachmentId: uuid.nullable().optional(),
})
export type ApprovalEvidenceInput = z.infer<typeof approvalEvidence>

export interface ApprovalEvidenceDto {
  kind: ApprovalEvidenceKind
  by: string | null
  note: string | null
  at: string
  attachmentId: string | null
}

export const jobLineInput = z.object({
  kind: JobLineKind.default('part'),
  description: z.string().trim().min(1).max(500),
  /** Quantity (pieces, hours, metres); 3 decimals kept. */
  qty: z.number().min(0).max(1_000_000).default(1),
  /** Net unit price in cents (VAT is applied on the job total). */
  unitCents: z.number().int().min(-100_000_000).max(100_000_000).default(0),
  partRef: nullableText(120),
})
export type JobLineInput = z.infer<typeof jobLineInput>
export const updateJobLineBody = patchOf(jobLineInput)
export type UpdateJobLineBody = z.infer<typeof updateJobLineBody>

export const createJobBody = z.object({
  /** Client-generated UUID (idempotency); optional from the office. */
  id: uuid.optional(),
  elevatorId: uuid,
  kind: JobKind.default('repair'),
  title: z.string().trim().min(1).max(200),
  description: nullableText(4000),
  originType: JobOriginType.default('office'),
  originId: uuid.nullable().optional(),
  /** Defaults to the building's customer. */
  customerId: uuid.nullable().optional(),
  lines: z.array(jobLineInput).max(100).default([]),
  notes: nullableText(4000),
})
export type CreateJobBody = z.infer<typeof createJobBody>

export const updateJobBody = z.object({
  kind: JobKind.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: nullableText(4000),
  customerId: uuid.nullable().optional(),
  notes: nullableText(4000),
  warrantyUntil: nullableDate,
})
export type UpdateJobBody = z.infer<typeof updateJobBody>

const deviceTime = {
  at: isoDateTime.optional(),
  clientOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).optional(),
  timestampSource: z.enum(['device', 'server', 'manual']).optional(),
}

/** Generic stage change; `evidence` is required when the target stage `requiresEvidence`. */
export const jobTransitionBody = z.object({
  to: jobStageCode,
  evidence: approvalEvidence.optional(),
  reason: nullableText(2000),
  at: isoDateTime.optional(),
})
export type JobTransitionBody = z.infer<typeof jobTransitionBody>

export const sendQuoteBody = z.object({
  /** none = mark as sent (handed over / printed); email / viber go through notifications. */
  channel: z.enum(['none', 'email', 'viber']).default('none'),
  email: z.email().optional(),
  phone: phone.optional(),
  message: nullableText(2000),
  validDays: z.number().int().min(1).max(365).optional(),
})
export type SendQuoteBody = z.infer<typeof sendQuoteBody>

export const scheduleJobBody = z.object({
  scheduledAt: isoDateTime,
  /** The technician pair (1..4). */
  assignedUserIds: z.array(uuid).min(1).max(4),
  notes: nullableText(2000),
})
export type ScheduleJobBody = z.infer<typeof scheduleJobBody>

export const startJobBody = z.object({ ...deviceTime, notes: nullableText(2000) })
export type StartJobBody = z.infer<typeof startJobBody>

export const jobNoteBody = z.object({ ...deviceTime, notes: z.string().trim().min(1).max(2000) })
export type JobNoteBody = z.infer<typeof jobNoteBody>

export const completeJobBody = z.object({
  ...deviceTime,
  /** When work started on site (defaults to startedAt, else the completion time). */
  startedAt: isoDateTime.optional(),
  notes: nullableText(4000),
  partsUsed: nullableText(2000),
  /** Warranty from completion; null = the tenant default. */
  warrantyMonths: z.number().int().min(0).max(120).nullable().optional(),
  /** Client-generated id of the repair visit (the technician app); idempotent on it. */
  visitId: uuid.optional(),
  /** Attachment ids the phone will upload for the visit (parent before child). */
  attachments: z.array(visitAttachmentLink).max(20).default([]),
  /** Who was on site; defaults to the assigned technicians (or the acting technician). */
  technicianUserIds: z.array(uuid).max(4).optional(),
  /** Skip the repair visit (nothing happened on site, e.g. a desk-only modernisation study). */
  createVisit: z.boolean().default(true),
})
export type CompleteJobBody = z.infer<typeof completeJobBody>

export const invoiceJobBody = z.object({
  /** full = the remaining job lines (a deposit already invoiced is deducted); partial = a deposit / instalment. */
  kind: z.enum(['full', 'partial']).default('full'),
  /** Net amount of a partial invoice. */
  amountCents: z.number().int().min(1).max(1_000_000_000).optional(),
  description: nullableText(500),
  issuedAt: isoDate.optional(),
  dueAt: isoDate.optional(),
})
export type InvoiceJobBody = z.infer<typeof invoiceJobBody>

export const jobReasonBody = z.object({
  reason: z.string().trim().min(1).max(2000),
  at: isoDateTime.optional(),
})
export type JobReasonBody = z.infer<typeof jobReasonBody>

export const jobStageInput = z.object({
  code: jobStageCode,
  bg: z.string().trim().min(1).max(80),
  en: z.string().trim().min(1).max(80),
  isTerminal: z.boolean().default(false),
  allowedNext: z.array(jobStageCode).max(20).default([]),
  requiresEvidence: z.boolean().default(false),
})
export type JobStageInput = z.infer<typeof jobStageInput>

/** Replace the tenant's stage list; an empty list returns to the system default. */
export const saveJobStagesBody = z.object({ stages: z.array(jobStageInput).max(30) })
export type SaveJobStagesBody = z.infer<typeof saveJobStagesBody>

const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional()

export const jobListQuery = listQuery.extend({
  /** One stage code or a comma-separated list. */
  status: z.string().trim().max(400).optional(),
  /** Every non-terminal stage. */
  open: boolQuery,
  elevatorId: uuid.optional(),
  buildingId: uuid.optional(),
  customerId: uuid.optional(),
  assignedUserId: uuid.optional(),
  kind: JobKind.optional(),
  originType: JobOriginType.optional(),
  originId: uuid.optional(),
  /** Created between (inclusive dates). */
  from: isoDate.optional(),
  to: isoDate.optional(),
})
export type JobListQuery = z.infer<typeof jobListQuery>

export const elevatorJobsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})

export interface JobLineDto {
  id: string
  quoteVersion: number
  kind: JobLineKind
  description: string
  qty: number
  unitCents: number
  totalCents: number
  partRef: string | null
  position: number
}

export interface JobEventDto {
  id: string
  type: string
  fromStatus: string | null
  toStatus: string | null
  at: string
  receivedAt: string
  source: EventSource
  byUserId: string | null
  byUserName: string | null
  data: Record<string, unknown>
}

export interface JobDto {
  id: string
  elevatorId: string
  elevatorInternalNo: string
  buildingId: string
  buildingAddressText: string
  customerId: string | null
  customerName?: string | null
  kind: JobKind
  title: string
  description: string | null
  originType: JobOriginType
  originId: string | null
  /** Stage code (data-driven; see GET /jobs/config). */
  status: string
  isTerminal: boolean
  quoteVersion: number
  netCents: number
  vatCents: number
  totalCents: number
  vatRatePercent: number
  lineCount: number
  approvalEvidence: ApprovalEvidenceDto | null
  quoteSentAt: string | null
  quoteValidUntil: string | null
  approvedAt: string | null
  scheduledAt: string | null
  assignedUserIds: string[]
  assignedUserNames: string[]
  startedAt: string | null
  completedAt: string | null
  visitId: string | null
  invoiceId: string | null
  /** Net amount already invoiced (deposits + the final invoice). */
  invoicedCents: number
  warrantyUntil: string | null
  rejectedReason: string | null
  cancelledReason: string | null
  notes: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface JobInvoiceRefDto {
  id: string
  number: number
  totalCents: number
  openCents: number
  status: string
  issuedAt: string
}

export interface JobDetailDto extends JobDto {
  lines: JobLineDto[]
  /** Lines of earlier quote versions (history), newest version first. */
  previousLines: JobLineDto[]
  events: JobEventDto[]
  invoices: JobInvoiceRefDto[]
}

export interface JobStageDto {
  code: string
  label: { bg: string; en: string }
  position: number
  isTerminal: boolean
  allowedNext: string[]
  requiresEvidence: boolean
}

export interface JobsConfigDto {
  stages: JobStageDto[]
  stagesCustomised: boolean
  kinds: JobKind[]
  originTypes: JobOriginType[]
  lineKinds: JobLineKind[]
  evidenceKinds: ApprovalEvidenceKind[]
  approvalReminderDays: number
  defaultWarrantyMonths: number
  quoteValidDays: number
  vatRatePercent: number
}

/** Dashboard widget "Ремонти": open quotes, awaiting approval, scheduled this week, done-not-invoiced. */
export interface JobsSummaryDto {
  openQuotes: { count: number; cents: number }
  awaitingApproval: { count: number; cents: number; overdue: number }
  scheduledThisWeek: { count: number }
  inProgress: { count: number }
  /** "Money leaking": completed work nobody has invoiced yet (net of deposits). */
  doneNotInvoiced: { count: number; cents: number }
}

export interface SendQuoteResultDto {
  job: JobDto
  /** Viber deep link + text when channel = viber (the office user sends it by hand). */
  viber: { url: string; text: string } | null
  /** Notification row id when an e-mail was queued. */
  notificationId: string | null
  printUrl: string
}

// ---- sync (technician app) ------------------------------------------------------------------

/** One outbox item of the technician app: start / note / complete on a job assigned to me. */
export const jobEventPayload = z.object({
  jobId: uuid,
  type: z.enum(['start', 'note', 'complete']),
  at: isoDateTime,
  clientOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).default(0),
  timestampSource: z.enum(['device', 'server', 'manual']).default('device'),
  notes: nullableText(4000),
  partsUsed: nullableText(2000),
  startedAt: isoDateTime.optional(),
  visitId: uuid.optional(),
  attachments: z.array(visitAttachmentLink).max(20).default([]),
})
export type JobEventPayload = z.infer<typeof jobEventPayload>
export type JobEventAttachment = VisitAttachmentLink
