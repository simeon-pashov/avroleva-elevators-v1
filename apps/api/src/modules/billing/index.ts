/**
 * billing (L3) - invoices, payments, credit notes, late fees, dunning as data, bank-statement
 * reconciliation, statements per building, payment links (ADR 0001). Owns: invoice,
 * invoice_sequence, payment, credit_note, credit_note_sequence, invoice_adjustment,
 * dunning_stage, late_fee_rule, bank_import, bank_import_row, payment_link.
 * Public interface: generate / runScheduled, list, get, detail, pay, recordPayment,
 * createPayment, listPayments, summary, buildingBilling, elevatorBilling, issueCreditNote,
 * runDunning / preview / config / stages / rules, bank imports, statement, payment links,
 * document renderers; router. Emits InvoiceIssued, InvoiceOverdue, DunningStageReached,
 * PaymentRecorded, PaymentMatched, CreditNoteIssued.
 */
export { billingRouter } from './http/router.js'
export {
  generate,
  issueInvoice,
  listForSource,
  list,
  get,
  detail,
  pay,
  recordPayment,
  createPayment,
  listPayments,
  summary,
  buildingBilling,
  elevatorBilling,
  rollStatuses,
  issueCreditNote,
  creditNotesOf,
  applyLateFee,
  bulk,
  effectiveBilling,
  providerStateFor,
  toInvoiceDto,
  toPaymentDto,
  toCreditNoteDto,
  withCustomerNames,
} from './service.js'
export type { RecordPaymentInput, RecordPaymentResult, IssueInvoiceInput } from './service.js'
export { runScheduled } from './run.js'
export {
  runDunning,
  preview as dunningPreview,
  config as billingConfig,
  saveStages,
  saveLateFeeRule,
  effectiveStages,
  effectiveRules,
  ensureSystemBillingDefaults,
  remindNow,
} from './dunning.js'
export {
  presets as bankPresets,
  preview as previewBankImport,
  get as getBankImport,
  list as listBankImports,
  matchRow as matchBankRow,
  commit as commitBankImport,
} from './reconciliation.js'
export { statement, statementWindow } from './statement.js'
export { createPaymentLink, resolveDemoLink, settleDemoLink, handleWebhook } from './links.js'
export type { ResolvedDemoLink } from './links.js'
export { publicPayment } from './statement.js'
export {
  listLinks as listAccessLinks,
  createLink as createAccessLink,
  rotateLink as rotateAccessLink,
  revokeLink as revokeAccessLink,
  sendLink as sendAccessLink,
  linkStatus as accessLinkStatus,
  activeLinkUrl,
  resolveAccessLink,
  recordOpen as recordAccessLinkOpen,
  resetOpenThrottle as resetAccessLinkOpenThrottle,
} from './accessLinks.js'
export type { ResolvedAccessLink } from './accessLinks.js'
export {
  linkState as accessLinkState,
  expiryFor as accessLinkExpiryFor,
  rotatedExpiry as accessLinkRotatedExpiry,
  ipHash as accessLinkIpHash,
  isAccessTokenShape,
  viberForwardUrl,
} from './domain/accessLink.js'
export { useStatementLinkNotifier } from './domain/ports.js'
export type { StatementLinkNotifier } from './domain/ports.js'
export { invoiceForPeriod } from './domain/invoice.js'
export type { InvoiceDraft, BillingSettings } from './domain/invoice.js'
export {
  cycleOf,
  periodMonths,
  periodStartsCycle,
  runTargetFor,
  addMonths,
  clampRunDay,
} from './domain/cycle.js'
export { nextStage, lateFeeFor, orderStages, stageDate } from './domain/dunning.js'
export { paymentReferenceFor, extractReference, normalizeReference } from './domain/reference.js'
export { epcPayload, parseEpcPayload, epcQrSvg, epcAmount } from './domain/epc.js'
export { bankDetailsOf, epcFor } from './domain/bank.js'
export {
  parseBankCsv,
  guessMapping,
  detectMapping,
  parseAmount,
  parseDate,
  BANK_PRESETS,
} from './domain/bankCsv.js'
export {
  matchRow as matchBankRowPure,
  matchRows,
  normalizeName,
  nameMatches,
} from './domain/match.js'
export { foldStatement } from './domain/statement.js'
export {
  INVOICE_STATES,
  INVOICE_TRANSITIONS,
  OPEN_STATUSES,
  openCentsOf,
  statusAfterBalanceChange,
} from './domain/states.js'
export { renderInvoiceHtml, renderStatementHtml, payBlock } from './domain/documents.js'
export const moduleInfo = { name: 'billing', layer: 3, status: 'active' } as const
