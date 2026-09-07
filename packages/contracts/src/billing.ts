import { z } from 'zod'
import { isoDate, nullableText, uuid } from './common.js'

// Values are the Postgres enum values (apps/api/prisma/schema.prisma) - keep them in sync.
export const InvoiceStatus = z.enum(['draft', 'issued', 'paid', 'overdue', 'void'])
export type InvoiceStatus = z.infer<typeof InvoiceStatus>

export const PaymentMethod = z.enum(['cash', 'bank', 'other'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

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
  /** Shortcut: issued + overdue. */
  pending: z.coerce.boolean().optional(),
  buildingId: uuid.optional(),
  customerId: uuid.optional(),
  /** Filter by invoice period (YYYY-MM). */
  month: yearMonth.optional(),
})
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>

export const payInvoiceBody = z.object({
  paidAt: isoDate,
  method: PaymentMethod.default('bank'),
  /** Defaults to the open balance. Partial payments keep the invoice open. */
  amountCents: z.number().int().min(1).max(100_000_000).optional(),
  note: nullableText(500),
})
export type PayInvoiceBody = z.infer<typeof payInvoiceBody>

export const createPaymentBody = z.object({
  buildingId: uuid,
  invoiceId: uuid.nullable().optional(),
  amountCents: z.number().int().min(1).max(100_000_000),
  paidAt: isoDate,
  method: PaymentMethod.default('bank'),
  note: nullableText(500),
})
export type CreatePaymentBody = z.infer<typeof createPaymentBody>

export const summaryQuery = z.object({ month: yearMonth.optional() })

export interface InvoiceLineDto {
  elevatorId: string
  description: string
  amountCents: number
}

export interface InvoiceDto {
  id: string
  number: number
  contractId: string
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
  /** totalCents - paidCents while open, 0 when paid/void. */
  openCents: number
  currency: string
  status: InvoiceStatus
  /** > 0 only for issued/overdue invoices past their due date (relative to today). */
  daysOverdue: number
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
  createdAt: string
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
