import { z } from 'zod'
import { isoDate, nullableText, uuid } from './common.js'
import { NotificationChannel } from './notifications.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const InvoiceStatus = z.enum([
  'draft',
  'issued',
  'paid',
  'overdue',
  'void',
  'partially_paid',
])
export type InvoiceStatus = z.infer<typeof InvoiceStatus>

export const PaymentMethod = z.enum(['cash', 'bank', 'other'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

/**
 * The methods a NEW payment may be recorded with. Наредба Н-18 ("СУПТО"): software that handles
 * sales needing a fiscal receipt becomes regulated sales-management software, so the app records
 * only non-cash payments (bank transfer, or another non-cash channel such as a payment provider).
 * `cash` stays in {@link PaymentMethod} because existing rows may hold it and read paths must keep
 * parsing them - it is simply never accepted on a request that creates a payment.
 */
export const NewPaymentMethod = z.enum(['bank', 'other'], { error: 'billing.cashNotAllowed' })
export type NewPaymentMethod = z.infer<typeof NewPaymentMethod>

export const PaymentSource = z.enum(['manual', 'bank_import', 'provider'])
export type PaymentSource = z.infer<typeof PaymentSource>

export const PaymentProviderName = z.enum(['none', 'demo', 'iris', 'stripe'])
export type PaymentProviderName = z.infer<typeof PaymentProviderName>

export const BillingCycle = z.enum(['monthly', 'quarterly', 'yearly'])
export type BillingCycle = z.infer<typeof BillingCycle>

/** YYYY-MM */
export const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
  message: 'validation.yearMonth',
})

export const generateInvoicesBody = z.object({ period: yearMonth })
export type GenerateInvoicesBody = z.infer<typeof generateInvoicesBody>

export const invoiceListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: InvoiceStatus.optional(),
  /** Shortcut: issued + partially_paid + overdue. */
  pending: z.coerce.boolean().optional(),
  buildingId: uuid.optional(),
  customerId: uuid.optional(),
  /** Filter by invoice period (YYYY-MM). */
  month: yearMonth.optional(),
  /** Invoice number or payment reference (substring). */
  q: z.string().trim().max(60).optional(),
  /** Only invoices that reached at least this dunning stage position. */
  dunningStage: z.coerce.number().int().min(0).max(20).optional(),
})
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>

export const payInvoiceBody = z.object({
  paidAt: isoDate,
  method: NewPaymentMethod.default('bank'),
  /** Defaults to the open balance. Less keeps the invoice open; more leaves the rest unallocated. */
  amountCents: z.number().int().min(1).max(100_000_000).optional(),
  note: nullableText(500),
  reference: nullableText(60),
})
export type PayInvoiceBody = z.infer<typeof payInvoiceBody>

export const createPaymentBody = z.object({
  buildingId: uuid,
  invoiceId: uuid.nullable().optional(),
  amountCents: z.number().int().min(1).max(100_000_000),
  paidAt: isoDate,
  method: NewPaymentMethod.default('bank'),
  note: nullableText(500),
  reference: nullableText(60),
})
export type CreatePaymentBody = z.infer<typeof createPaymentBody>

export const summaryQuery = z.object({ month: yearMonth.optional() })

/** POST /billing/invoices/:id/credit-notes - a numbered credit note against an issued invoice. */
export const createCreditNoteBody = z.object({
  /** Gross amount to credit (VAT included); defaults to the whole open balance. */
  totalCents: z.number().int().min(1).max(100_000_000).optional(),
  reason: z.string().trim().min(2).max(500),
  issuedAt: isoDate.optional(),
})
export type CreateCreditNoteBody = z.infer<typeof createCreditNoteBody>

/** POST /billing/invoices/bulk */
export const bulkInvoiceBody = z.object({
  action: z.enum(['remind', 'pay']),
  ids: z.array(uuid).min(1).max(200),
  paidAt: isoDate.optional(),
  method: NewPaymentMethod.optional(),
})
export type BulkInvoiceBody = z.infer<typeof bulkInvoiceBody>

export interface BulkInvoiceResultDto {
  action: BulkInvoiceBody['action']
  done: number
  skipped: number
}

export interface InvoiceLineDto {
  elevatorId: string
  description: string
  amountCents: number
}

export interface InvoiceDto {
  id: string
  number: number
  /** Printed on every document; what the payer writes on the transfer. */
  paymentReference: string
  /** null for invoices that did not come from a contract (job invoices). */
  contractId: string | null
  buildingId: string
  buildingAddressText?: string
  customerId: string
  customerName?: string
  /** YYYY-MM */
  period: string
  periodStart: string
  periodEnd: string
  issuedAt: string
  dueAt: string
  amountCents: number
  vatCents: number
  totalCents: number
  paidCents: number
  lateFeeCents: number
  creditedCents: number
  /** total + lateFee - credited - paid while open, 0 when paid/void. */
  openCents: number
  currency: string
  status: InvoiceStatus
  /** > 0 only for open invoices past their due date (relative to today). */
  daysOverdue: number
  dunningStage: number
  dunningStageKey: string | null
  dunningAt: string | null
  sourceType: string
  sourceId: string | null
  /** The repair job this invoice was created from (sourceType 'job'), else null. */
  jobId: string | null
  lines: InvoiceLineDto[]
  paidAt: string | null
  createdAt: string
}

export interface PaymentDto {
  id: string
  invoiceId: string | null
  invoiceNumber?: number | null
  buildingId: string
  buildingAddressText?: string
  amountCents: number
  paidAt: string
  method: PaymentMethod
  note: string | null
  reference: string | null
  source: PaymentSource
  provider: string | null
  providerRef: string | null
  counterparty: string | null
  createdAt: string
}

export interface CreditNoteDto {
  id: string
  invoiceId: string
  invoiceNumber?: number
  number: number
  issuedAt: string
  amountCents: number
  vatCents: number
  totalCents: number
  reason: string
  createdAt: string
}

export interface InvoiceAdjustmentDto {
  id: string
  invoiceId: string
  kind: 'late_fee'
  amountCents: number
  reason: string | null
  stageKey: string | null
  createdAt: string
}

export interface PaymentLinkDto {
  id: string
  invoiceId: string
  provider: string
  url: string
  amountCents: number
  status: 'open' | 'paid' | 'expired'
  createdAt: string
  expiresAt: string
  paidAt: string | null
}

/** EPC069-12 "SEPA credit transfer" QR: the payload text and its SVG. */
export interface EpcQrDto {
  payload: string
  svg: string
  amountCents: number
  reference: string
}

export interface TenantBankDetailsDto {
  beneficiary: string
  iban: string
  /** Grouped in fours for display. */
  ibanFormatted: string
  bic: string
  bankName: string
}

/** GET /billing/invoices/:id - everything the detail page and the print page show. */
export interface InvoiceDetailDto extends InvoiceDto {
  payments: PaymentDto[]
  creditNotes: CreditNoteDto[]
  adjustments: InvoiceAdjustmentDto[]
  paymentLinks: PaymentLinkDto[]
  /** Null when the tenant has no bank details yet. */
  bank: TenantBankDetailsDto | null
  /** Null when there is nothing open or no bank details. */
  epc: EpcQrDto | null
  /** Which provider the tenant selected and whether it can produce a hosted link right now. */
  paymentProvider: { name: PaymentProviderName; enabled: boolean; note: string | null }
}

export interface GenerateInvoicesResultDto {
  period: string
  created: number
  skipped: number
  invoices: InvoiceDto[]
}

export interface BillingSummaryDto {
  month: string
  pendingCents: number
  pendingCount: number
  overdueCents: number
  overdueCount: number
  paidThisMonthCents: number
  paidThisMonthCount: number
}

/** Billing view of one building (or one elevator through its building's contract). */
export interface BuildingBillingDto {
  buildingId: string
  /** Set when requested for an elevator: that elevator's share of each invoice. */
  elevatorId?: string
  invoices: Array<InvoiceDto & { elevatorAmountCents?: number }>
  payments: PaymentDto[]
  pendingCents: number
  overdueCents: number
}

// ---- Billing configuration as data (ADR 0001 section 2) ------------------------------------

const keyish = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .regex(/^[a-z0-9_]+$/, { message: 'validation.key' })

export const dunningStageInput = z.object({
  key: keyish(40),
  offsetDays: z.number().int().min(0).max(365),
  channel: NotificationChannel,
  templateKey: keyish(60),
  lateFeeRuleKey: nullableText(40),
  active: z.boolean().default(true),
})
export type DunningStageInput = z.infer<typeof dunningStageInput>

/** PUT /billing/dunning-stages - replaces the tenant's list (an empty list restores the system default). */
export const saveDunningStagesBody = z.object({
  stages: z.array(dunningStageInput).max(20),
})
export type SaveDunningStagesBody = z.infer<typeof saveDunningStagesBody>

export interface DunningStageDto extends DunningStageInput {
  id: string
  /** null = system default row. */
  tenantId: string | null
  position: number
}

export const lateFeeRuleInput = z.object({
  kind: z.enum(['flat', 'percent']).default('flat'),
  amountCents: z.number().int().min(0).max(100_000_00).default(0),
  /** Basis points (100 = 1 %). */
  percentBp: z.number().int().min(0).max(10_000).default(0),
  graceDays: z.number().int().min(0).max(365).default(0),
  capCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
  enabled: z.boolean().default(false),
})
export type LateFeeRuleInput = z.infer<typeof lateFeeRuleInput>

export interface LateFeeRuleDto extends LateFeeRuleInput {
  id: string
  tenantId: string | null
  key: string
}

export interface InvoiceStateDto {
  key: InvoiceStatus
  /** Badge tone for the UI. */
  tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info'
  open: boolean
}

export interface InvoiceTransitionDto {
  from: InvoiceStatus
  to: InvoiceStatus
  trigger: string
  roles: string[]
}

/** GET /billing/config - the state machine, stages, fee rules and providers as data. */
export interface BillingConfigDto {
  states: InvoiceStateDto[]
  transitions: InvoiceTransitionDto[]
  stages: DunningStageDto[]
  /** True when the stages come from the tenant's own rows. */
  stagesCustomised: boolean
  lateFeeRules: LateFeeRuleDto[]
  providers: Array<{ name: PaymentProviderName; enabled: boolean; note: string | null }>
  /** Sample reference for the settings page ("AE-1234-000001"). */
  referenceSample: string
}

// ---- Bank-statement import ---------------------------------------------------------------------

export const bankCsvMapping = z.object({
  /** Auto-detected when absent. */
  delimiter: z.enum([',', ';', '\t']).optional(),
  hasHeader: z.boolean().default(true),
  /** Column indexes (0-based). */
  dateColumn: z.number().int().min(0).max(100),
  /** One signed amount column, or separate credit / debit columns. */
  amountColumn: z.number().int().min(0).max(100).nullable().optional(),
  creditColumn: z.number().int().min(0).max(100).nullable().optional(),
  debitColumn: z.number().int().min(0).max(100).nullable().optional(),
  counterpartyColumn: z.number().int().min(0).max(100).nullable().optional(),
  descriptionColumn: z.number().int().min(0).max(100),
  referenceColumn: z.number().int().min(0).max(100).nullable().optional(),
  dateFormat: z
    .enum(['DD.MM.YYYY', 'DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD'])
    .default('DD.MM.YYYY'),
  decimalSeparator: z.enum([',', '.']).default(','),
  /** Extra lines to skip before the header (bank exports often start with an account block). */
  skipRows: z.number().int().min(0).max(50).default(0),
})
export type BankCsvMapping = z.infer<typeof bankCsvMapping>

export const bankImportPreviewBody = z.object({
  filename: z.string().trim().min(1).max(200),
  /** The CSV text (the office reads the file in the browser). */
  text: z.string().min(1).max(4_000_000),
  /** Explicit mapping; otherwise a preset; otherwise the tenant's saved mapping; otherwise auto-detected. */
  mapping: bankCsvMapping.optional(),
  preset: z.string().trim().max(40).optional(),
})
export type BankImportPreviewBody = z.infer<typeof bankImportPreviewBody>

export const matchBankRowBody = z.object({
  invoiceId: uuid.nullable().optional(),
  /** Unallocated payment for a building (no invoice). */
  buildingId: uuid.nullable().optional(),
  ignore: z.boolean().optional(),
})
export type MatchBankRowBody = z.infer<typeof matchBankRowBody>

export interface BankImportRowDto {
  id: string
  position: number
  bookedAt: string
  amountCents: number
  counterparty: string
  description: string
  reference: string | null
  matchKind: 'reference' | 'amount_name' | 'manual' | 'none'
  status: 'proposed' | 'matched' | 'unallocated' | 'ignored' | 'booked'
  invoiceId: string | null
  invoiceNumber: number | null
  invoiceOpenCents: number | null
  buildingId: string | null
  buildingAddressText: string | null
  paymentId: string | null
  note: string | null
}

export interface BankImportDto {
  id: string
  filename: string
  status: 'preview' | 'committed'
  mapping: BankCsvMapping
  rowCount: number
  matchedCount: number
  bookedCount: number
  createdAt: string
  committedAt: string | null
  rows: BankImportRowDto[]
  /** Lines the parser could not read (shown once in the preview). */
  parseErrors: string[]
}

export interface BankCsvPresetDto {
  key: string
  name: string
  mapping: BankCsvMapping
}

export interface BankImportCommitResultDto {
  importId: string
  booked: number
  unallocated: number
  ignored: number
}

// ---- Statement per building ------------------------------------------------------------------

export const statementQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
})
export type StatementQuery = z.infer<typeof statementQuery>

export interface StatementLineDto {
  date: string
  kind: 'invoice' | 'payment' | 'credit_note' | 'late_fee'
  /** Invoice / credit note number or the payment reference. */
  ref: string
  description: string
  /** What the building owes (invoice, late fee). */
  debitCents: number
  /** What it paid or was credited. */
  creditCents: number
  balanceCents: number
  invoiceId: string | null
}

export interface BuildingStatementDto {
  buildingId: string
  buildingAddressText: string
  customerName: string | null
  contactName: string | null
  contactEmail: string | null
  from: string
  to: string
  openingBalanceCents: number
  lines: StatementLineDto[]
  closingBalanceCents: number
  /** Open invoices at the end of the window (what the EPC QR asks for). */
  openInvoices: Array<{
    id: string
    number: number
    paymentReference: string
    openCents: number
    /** YYYY-MM (step 9: shown on the building's statement page). */
    period?: string
    dueAt?: string
  }>
  bank: TenantBankDetailsDto | null
  epc: EpcQrDto | null
  /** BASE_PATH-relative print page. */
  printUrl: string
}

export const sendStatementBody = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Overrides the building contact's e-mail. */
  email: z.email().optional(),
})
export type SendStatementBody = z.infer<typeof sendStatementBody>

// ---- Dunning preview -------------------------------------------------------------------------------

export interface DunningPreviewItemDto {
  invoiceId: string
  number: number
  buildingId: string
  buildingAddressText?: string
  customerName?: string
  openCents: number
  dueAt: string
  daysOverdue: number
  currentStage: number
  nextStageKey: string
  nextStagePosition: number
  channel: NotificationChannel
  lateFeeCents: number
}

export interface DunningPreviewDto {
  today: string
  items: DunningPreviewItemDto[]
}

// ---- Payment links --------------------------------------------------------------------------------

export interface CreatePaymentLinkResultDto {
  link: PaymentLinkDto
}

/** Demo-mode data generation (platform admin). */
export const demoDataBody = z.object({
  /** Delete the tenant's operational data first (demoMode tenants only). */
  reset: z.boolean().default(false),
  months: z.number().int().min(1).max(24).default(12),
})
export type DemoDataBody = z.infer<typeof demoDataBody>
