/**
 * jobs (L3, step 8) - repair jobs and quotes: the job is the quote (lines) walking through
 * DATA-driven stages (draft -> quoted -> awaiting_approval -> approved -> scheduled -> in_progress
 * -> done -> invoiced, + rejected / cancelled; system defaults + tenant override). Owns: job,
 * job_line, job_event, job_stage.
 * Public interface: create, update, lines, markQuoted, sendQuote, revise, transition, schedule,
 * start, addNote, complete (repair visit through the VisitRecorder port), invoice (through the
 * InvoiceIssuer port), reject, cancel · get, list, listForElevator, byOrigin, summary,
 * listForSync, awaitingApprovalRows, remindApprovals, quoteHtml, config, saveStages; router.
 * Emits JobCreated, JobQuoted, JobApproved, JobScheduled, JobStarted, JobCompleted, JobInvoiced,
 * JobRejected, JobCancelled, JobApprovalReminder. Talks to billing / visits / notifications only
 * through the ports in domain/ports.ts (wired in app.ts).
 */
export { jobsRouter } from './http/router.js'
export {
  create,
  update,
  addLine,
  updateLine,
  removeLine,
  markQuoted,
  sendQuote,
  revise,
  transition,
  schedule,
  start,
  addNote,
  complete,
  invoice,
  reject,
  cancel,
  get,
  list,
  listForElevator,
  byOrigin,
  summary,
  listForSync,
  awaitingApprovalRows,
  remindApprovals,
  quoteHtml,
  config,
  saveStages,
  effectiveStages,
  ensureSystemJobStages,
  toJobDto,
  toLineDto,
} from './service.js'
export { useVisitRecorder, useInvoiceIssuer, useQuoteNotifier } from './domain/ports.js'
export type { VisitRecorder, InvoiceIssuer, QuoteNotifier } from './domain/ports.js'
export {
  canTransition,
  requiresEvidence,
  isTerminal,
  openStageCodes,
  orderStages,
  validateStages,
  defaultStages,
  toStageDto,
  REQUIRED_STAGE_CODES,
} from './domain/stages.js'
export type { StageDef } from './domain/stages.js'
export {
  lineTotalCents,
  quoteTotals,
  remainingNetCents,
  summarizeJobs,
  approvalOverdue,
  approvalDueAt,
} from './domain/quote.js'
export { renderQuoteHtml } from './domain/document.js'
export type { JobRow } from './repo/jobs.js'
export const moduleInfo = { name: 'jobs', layer: 3, status: 'active' } as const
