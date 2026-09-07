import type { ContractDto, InvoiceLineDto } from '@avroleva/contracts'
import { addDays, monthBounds } from '../../../platform/clock.js'

export interface InvoiceDraft {
  periodStart: string
  periodEnd: string
  issuedAt: string
  dueAt: string
  amountCents: number
  vatCents: number
  totalCents: number
  lines: InvoiceLineDto[]
}

export interface BillingSettings {
  invoiceDueDays: number
  vatRatePercent: number
}

/**
 * Pure: the invoice a contract yields for a YYYY-MM period, or null when nothing is billable
 * (no line in force that month, or a zero total). A line is in force when it started on or
 * before the period's last day and has not ended before the period's first day. Prices are
 * monthly, so a line is billed in full for any month it overlaps (no pro-rating in the MVP).
 * VAT is rounded half-up per invoice, not per line (ЗДДС allows either; one rounding is simpler
 * to reconcile with the accountant's sample).
 */
export function invoiceForPeriod(
  contract: Pick<ContractDto, 'lines' | 'paymentDay' | 'startDate' | 'endDate'>,
  period: string,
  settings: BillingSettings,
): InvoiceDraft | null {
  const { start, end } = monthBounds(period)
  if (contract.startDate > end) return null
  if (contract.endDate && contract.endDate < start) return null
  const lines: InvoiceLineDto[] = []
  for (const l of contract.lines) {
    if (l.monthlyPriceCents <= 0) continue
    if (l.fromDate && l.fromDate > end) continue
    if (l.toDate && l.toDate < start) continue
    lines.push({
      elevatorId: l.elevatorId,
      description: `${l.elevatorInternalNo ?? l.elevatorId} · ${period}`,
      amountCents: l.monthlyPriceCents,
    })
  }
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0)
  if (amountCents <= 0) return null
  const vatCents = Math.round((amountCents * settings.vatRatePercent) / 100)
  const issuedAt = start
  const dueAt = contract.paymentDay
    ? `${period}-${String(Math.min(contract.paymentDay, 28)).padStart(2, '0')}`
    : addDays(issuedAt, settings.invoiceDueDays)
  return {
    periodStart: start,
    periodEnd: end,
    issuedAt,
    dueAt,
    amountCents,
    vatCents,
    totalCents: amountCents + vatCents,
    lines,
  }
}
