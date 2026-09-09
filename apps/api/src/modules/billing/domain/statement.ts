import type { StatementLineDto } from '@avroleva/contracts'

/**
 * Statement fold (pure, ADR 0001): a building's invoices, late fees, credit notes and payments
 * become one dated ledger with a running balance. Everything before `from` collapses into the
 * opening balance; void invoices (and their payments, which cannot exist) are excluded.
 */
export interface StatementInvoice {
  id: string
  number: number
  status: string
  issuedAt: string
  totalCents: number
  paymentReference: string
  period: string
}
export interface StatementPayment {
  id: string
  paidAt: string
  amountCents: number
  invoiceId: string | null
  invoiceNumber: number | null
  reference: string | null
  method: string
}
export interface StatementCreditNote {
  id: string
  number: number
  issuedAt: string
  totalCents: number
  invoiceId: string
  invoiceNumber: number
}
export interface StatementAdjustment {
  id: string
  date: string
  amountCents: number
  invoiceId: string
  invoiceNumber: number
  stageKey: string | null
}

export interface StatementInputs {
  invoices: StatementInvoice[]
  payments: StatementPayment[]
  creditNotes: StatementCreditNote[]
  adjustments: StatementAdjustment[]
}

export interface StatementLabels {
  invoice: (i: StatementInvoice) => string
  payment: (p: StatementPayment) => string
  creditNote: (c: StatementCreditNote) => string
  lateFee: (a: StatementAdjustment) => string
}

const ORDER: Record<StatementLineDto['kind'], number> = {
  invoice: 0,
  late_fee: 1,
  credit_note: 2,
  payment: 3,
}

export function foldStatement(
  inputs: StatementInputs,
  from: string,
  to: string,
  labels: StatementLabels,
): { openingBalanceCents: number; lines: StatementLineDto[]; closingBalanceCents: number } {
  const events: Array<Omit<StatementLineDto, 'balanceCents'>> = []
  for (const i of inputs.invoices) {
    if (i.status === 'void' || i.status === 'draft') continue
    events.push({
      date: i.issuedAt,
      kind: 'invoice',
      ref: String(i.number),
      description: labels.invoice(i),
      debitCents: i.totalCents,
      creditCents: 0,
      invoiceId: i.id,
    })
  }
  for (const a of inputs.adjustments) {
    events.push({
      date: a.date,
      kind: 'late_fee',
      ref: String(a.invoiceNumber),
      description: labels.lateFee(a),
      debitCents: a.amountCents,
      creditCents: 0,
      invoiceId: a.invoiceId,
    })
  }
  for (const c of inputs.creditNotes) {
    events.push({
      date: c.issuedAt,
      kind: 'credit_note',
      ref: String(c.number),
      description: labels.creditNote(c),
      debitCents: 0,
      creditCents: c.totalCents,
      invoiceId: c.invoiceId,
    })
  }
  for (const p of inputs.payments) {
    events.push({
      date: p.paidAt,
      kind: 'payment',
      ref: p.reference ?? (p.invoiceNumber != null ? String(p.invoiceNumber) : ''),
      description: labels.payment(p),
      debitCents: 0,
      creditCents: p.amountCents,
      invoiceId: p.invoiceId,
    })
  }
  events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind] || a.ref.localeCompare(b.ref),
  )
  let balance = 0
  const lines: StatementLineDto[] = []
  for (const e of events) {
    if (e.date > to) break
    balance += e.debitCents - e.creditCents
    if (e.date < from) continue
    lines.push({ ...e, balanceCents: balance })
  }
  const opening = lines.length
    ? lines[0]!.balanceCents - lines[0]!.debitCents + lines[0]!.creditCents
    : balance
  return { openingBalanceCents: opening, lines, closingBalanceCents: balance }
}
