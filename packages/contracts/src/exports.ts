import { z } from 'zod'
import { uuid } from './common.js'
import { yearMonth } from './billing.js'

// ---- Exports and reports (reporting, L4) ---------------------------------------------------

/** Datasets served as CSV at GET /exports/:dataset.csv and bundled by the full export. */
export const EXPORT_DATASETS = [
  'elevators',
  'buildings',
  'customers',
  'contacts',
  'contracts',
  'visits',
  'callbacks',
  'defects',
  'inspections',
  'invoices',
  'payments',
  'notifications',
  'audit',
] as const
export type ExportDataset = (typeof EXPORT_DATASETS)[number]
export const exportDataset = z.enum(EXPORT_DATASETS)

export const ExportJobStatus = z.enum(['queued', 'running', 'done', 'failed'])
export type ExportJobStatus = z.infer<typeof ExportJobStatus>

export interface ExportJobDto {
  id: string
  kind: 'full'
  status: ExportJobStatus
  requestedByUserId: string | null
  requestedByName: string | null
  bytes: number | null
  error: string | null
  createdAt: string
  finishedAt: string | null
  /** The signed link is valid until then (24 h after completion). */
  expiresAt: string | null
  /** Signed download URL (BASE_PATH-relative), present while status = done and not expired. */
  downloadUrl: string | null
  /** Counts per dataset written into the zip. */
  summary: Record<string, number> | null
}

export const EXPORT_LINK_TTL_SECONDS = 24 * 60 * 60

// ---- Monthly building report ----------------------------------------------------------------

export const buildingReportQuery = z.object({ month: yearMonth })
export type BuildingReportQuery = z.infer<typeof buildingReportQuery>

export const sendBuildingReportBody = z.object({
  month: yearMonth,
  /** Override the recipient (defaults to the building's primary contact with an e-mail). */
  to: z.email().optional(),
})
export type SendBuildingReportBody = z.infer<typeof sendBuildingReportBody>

export const bulkBuildingReportBody = z.object({
  month: yearMonth,
  /** false = only log the runs (generate); true = also e-mail every building with a contact e-mail. */
  send: z.boolean().default(false),
})
export type BulkBuildingReportBody = z.infer<typeof bulkBuildingReportBody>

export const ReportRunStatus = z.enum(['generated', 'sent', 'failed', 'skipped'])
export type ReportRunStatus = z.infer<typeof ReportRunStatus>

export interface ReportRunDto {
  id: string
  kind: 'building_month' | 'statement'
  buildingId: string | null
  buildingAddressText: string | null
  period: string
  status: ReportRunStatus
  sentTo: string | null
  notificationId: string | null
  error: string | null
  byUserId: string | null
  createdAt: string
  /** `/print/building-report/:buildingId?month=` (BASE_PATH-relative). */
  printUrl: string | null
}

export interface BulkReportResultDto {
  period: string
  buildings: number
  generated: number
  sent: number
  skipped: number
  failed: number
}

export const reportListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  buildingId: uuid.optional(),
  period: yearMonth.optional(),
})
export type ReportListQuery = z.infer<typeof reportListQuery>

/** Data behind GET /print/building-report/:buildingId (also returned as JSON for tests). */
export interface BuildingReportDto {
  period: string
  periodStart: string
  periodEnd: string
  generatedAt: string
  tenant: {
    name: string
    phone: string
    emergencyPhone: string
    email: string | null
    address: string
  }
  building: {
    id: string
    addressText: string
    customerName: string | null
    contactName: string | null
    contactEmail: string | null
    contactPhone: string | null
  }
  elevators: Array<{
    id: string
    internalNo: string
    regNo: string | null
    status: string
    nextCheckDueAt: string | null
    nextInspectionAt: string | null
    visits: Array<{
      id: string
      startedAt: string
      kind: string
      technicians: string[]
      checklistSummary: { ok: number; defect: number; na: number } | null
      defectsFound: string[]
      notes: string | null
    }>
    callbacks: Array<{
      id: string
      receivedAt: string
      classification: string
      status: string
      responseMinutes: number | null
      cause: string | null
    }>
    openDefects: Array<{ id: string; description: string; recordedAt: string; stopLift: boolean }>
  }>
  totals: {
    visits: number
    callbacks: number
    avgResponseMinutes: number | null
    openDefects: number
  }
  billing: {
    invoices: Array<{
      id: string
      number: number
      period: string
      totalCents: number
      paidCents: number
      status: string
      dueAt: string
    }>
    outstandingCents: number
  }
}
