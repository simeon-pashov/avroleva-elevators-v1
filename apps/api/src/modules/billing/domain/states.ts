import type { InvoiceStateDto, InvoiceStatus, InvoiceTransitionDto } from '@avroleva/contracts'

/**
 * The invoice state machine as data (ADR 0001 section 2): the office UI reads this through
 * GET /billing/config for its filters and badges instead of hard-coding the enum; the service
 * functions below are the only places that compute a status.
 */
export const INVOICE_STATES: InvoiceStateDto[] = [
  { key: 'issued', tone: 'warn', open: true },
  { key: 'partially_paid', tone: 'info', open: true },
  { key: 'overdue', tone: 'danger', open: true },
  { key: 'paid', tone: 'ok', open: false },
  { key: 'void', tone: 'muted', open: false },
  { key: 'draft', tone: 'muted', open: false },
]

export const INVOICE_TRANSITIONS: InvoiceTransitionDto[] = [
  { from: 'draft', to: 'issued', trigger: 'billing.run', roles: ['system', 'owner', 'office'] },
  { from: 'issued', to: 'overdue', trigger: 'billing.rollOverdue', roles: ['system'] },
  { from: 'partially_paid', to: 'overdue', trigger: 'billing.rollOverdue', roles: ['system'] },
  {
    from: 'issued',
    to: 'partially_paid',
    trigger: 'payment',
    roles: ['owner', 'office', 'system'],
  },
  { from: 'issued', to: 'paid', trigger: 'payment', roles: ['owner', 'office', 'system'] },
  { from: 'partially_paid', to: 'paid', trigger: 'payment', roles: ['owner', 'office', 'system'] },
  { from: 'overdue', to: 'paid', trigger: 'payment', roles: ['owner', 'office', 'system'] },
  { from: 'issued', to: 'paid', trigger: 'credit_note', roles: ['owner', 'office'] },
  { from: 'overdue', to: 'paid', trigger: 'credit_note', roles: ['owner', 'office'] },
  { from: 'partially_paid', to: 'paid', trigger: 'credit_note', roles: ['owner', 'office'] },
  { from: 'issued', to: 'void', trigger: 'void', roles: ['owner'] },
  { from: 'overdue', to: 'void', trigger: 'void', roles: ['owner'] },
]

export const OPEN_STATUSES: InvoiceStatus[] = ['issued', 'partially_paid', 'overdue']

export function isOpenStatus(s: InvoiceStatus): boolean {
  return OPEN_STATUSES.includes(s)
}

export interface BalanceLike {
  status: InvoiceStatus
  totalCents: number
  lateFeeCents: number
  creditedCents: number
  paidCents: number
}

/** total + late fees - credit notes - payments, never negative; 0 for paid / void. */
export function openCentsOf(i: BalanceLike): number {
  if (!isOpenStatus(i.status)) return 0
  return Math.max(0, i.totalCents + i.lateFeeCents - i.creditedCents - i.paidCents)
}

/**
 * Status after the balance changed (payment, credit note, late fee): paid when nothing is open;
 * overdue stays overdue while something is open past due; partially paid once money came in.
 */
export function statusAfterBalanceChange(
  i: BalanceLike & { dueAt: string },
  today: string,
): InvoiceStatus {
  if (!isOpenStatus(i.status)) return i.status
  const open = i.totalCents + i.lateFeeCents - i.creditedCents - i.paidCents
  if (open <= 0) return 'paid'
  if (i.dueAt < today) return 'overdue'
  if (i.paidCents > 0) return 'partially_paid'
  return 'issued'
}
