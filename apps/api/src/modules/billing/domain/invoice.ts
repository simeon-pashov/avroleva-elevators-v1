import type { ContractDto, InvoiceLineDto } from '@avroleva/contracts'
import { addDays, monthBounds } from '../../../platform/clock.js'
import { addMonths, periodEnd } from './cycle.js'

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
 * Pure: the invoice a contract yields for a period of `months` months starting at YYYY-MM
 * `period` (1 = the monthly invoice of step 2; 3 / 12 for quarterly / yearly contracts, ADR 0001),
 * or null when nothing is billable. A line is billed once for every month of the period it
 * overlaps: it started on or before that month's last day and has not ended before its first
 * day. Prices are monthly, no pro-rating (a month is billed in full for any overlap). VAT is
 * rounded half-up per invoice, not per line (ЗДДС allows either; one rounding is simpler to
 * reconcile with the accountant's sample). Due date: the contract's paymentDay in the first
 * month of the period, else issue date + invoiceDueDays.
 */
export function invoiceForPeriod(
  contract: Pick<ContractDto, 'lines' | 'paymentDay' | 'startDate' | 'endDate'>,
  period: string,
  settings: BillingSettings,
  months = 1,
): InvoiceDraft | null {
  const { start } = monthBounds(period)
  const end = periodEnd(period, months)
  if (contract.startDate > end) return null
  if (contract.endDate && contract.endDate < start) return null
  const lines: InvoiceLineDto[] = []
  for (const l of contract.lines) {
    if (l.monthlyPriceCents <= 0) continue
    let billed = 0
    for (let k = 0; k < months; k++) {
      const m = monthBounds(addMonths(period, k))
      if (contract.startDate > m.end) continue
      if (contract.endDate && contract.endDate < m.start) continue
      if (l.fromDate && l.fromDate > m.end) continue
      if (l.toDate && l.toDate < m.start) continue
      billed++
    }
    if (billed === 0) continue
    const label = months === 1 ? period : `${period} – ${addMonths(period, months - 1)}`
    lines.push({
      elevatorId: l.elevatorId,
      description: `${l.elevatorInternalNo ?? l.elevatorId} · ${label}${billed !== months ? ` (${billed})` : ''}`,
      amountCents: l.monthlyPriceCents * billed,
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
