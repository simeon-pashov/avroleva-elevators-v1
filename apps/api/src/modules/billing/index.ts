/**
 * billing (L3, light) - invoices and payments. Owns: invoice, invoice_sequence, payment.
 * Public interface: generate(period), list, get, pay, createPayment, listPayments, summary,
 * buildingBilling, elevatorBilling; router. Emits InvoiceIssued, PaymentRecorded.
 *
 * Status roll (issued -> overdue): there is no scheduler yet, so `rollStatuses(tenantId)` runs at
 * the start of every billing read (one UPDATE ... WHERE status='issued' AND dueAt < today). When
 * pg-boss lands (notifications step) the same function becomes the nightly job and emits
 * InvoiceOverdue.
 */
export { billingRouter } from './http/router.js'
export {
  generate,
  list,
  get,
  pay,
  createPayment,
  listPayments,
  summary,
  buildingBilling,
  elevatorBilling,
  rollStatuses,
  toInvoiceDto,
  toPaymentDto,
} from './service.js'
export { invoiceForPeriod } from './domain/invoice.js'
export type { InvoiceDraft, BillingSettings } from './domain/invoice.js'
export const moduleInfo = { name: 'billing', layer: 3, status: 'active' } as const
