import type { JobsSummaryDto } from '@avroleva/contracts'

/**
 * Quote money (pure). Lines carry a quantity and a net unit price in cents; a line total is
 * rounded half-up to the cent; VAT is rounded ONCE on the job's net total (the same rule the
 * contract invoices use, so the invoice created from the job matches the quote to the cent).
 */
export function lineTotalCents(qty: number, unitCents: number): number {
  return Math.round(qty * unitCents)
}

export interface QuoteTotals {
  netCents: number
  vatCents: number
  totalCents: number
}

export function quoteTotals(
  lines: ReadonlyArray<{ totalCents: number }>,
  vatRatePercent: number,
): QuoteTotals {
  const netCents = lines.reduce((s, l) => s + l.totalCents, 0)
  const vatCents = Math.round((netCents * vatRatePercent) / 100)
  return { netCents, vatCents, totalCents: netCents + vatCents }
}

/** Net amount still to invoice for a job (deposits already invoiced are deducted). */
export function remainingNetCents(job: { netCents: number; invoicedCents: number }): number {
  return Math.max(0, job.netCents - job.invoicedCents)
}

export interface SummaryJob {
  status: string
  netCents: number
  totalCents: number
  invoicedCents: number
  quoteSentAt: Date | null
  updatedAt: Date
  scheduledAt: Date | null
}

export interface SummaryOptions {
  /** Now (for "awaiting approval longer than N days" and "this week"). */
  now: Date
  approvalReminderDays: number
  /** Start (inclusive) and end (exclusive) of the current week, Sofia. */
  weekStart: Date
  weekEnd: Date
}

/**
 * Dashboard counts (pure): open quotes = quoted + awaiting_approval (gross value), awaiting
 * approval (+ how many are older than the reminder window), scheduled this week, in progress,
 * and the "money leaking" number: jobs `done` whose remaining net amount nobody invoiced yet.
 */
export function summarizeJobs(jobs: SummaryJob[], o: SummaryOptions): JobsSummaryDto {
  const out: JobsSummaryDto = {
    openQuotes: { count: 0, cents: 0 },
    awaitingApproval: { count: 0, cents: 0, overdue: 0 },
    scheduledThisWeek: { count: 0 },
    inProgress: { count: 0 },
    doneNotInvoiced: { count: 0, cents: 0 },
  }
  const reminderMs = o.approvalReminderDays * 86_400_000
  for (const j of jobs) {
    if (j.status === 'quoted' || j.status === 'awaiting_approval') {
      out.openQuotes.count++
      out.openQuotes.cents += j.totalCents
    }
    if (j.status === 'awaiting_approval') {
      out.awaitingApproval.count++
      out.awaitingApproval.cents += j.totalCents
      const since = j.quoteSentAt ?? j.updatedAt
      if (o.now.getTime() - since.getTime() >= reminderMs) out.awaitingApproval.overdue++
    }
    if (
      j.status === 'scheduled' &&
      j.scheduledAt &&
      j.scheduledAt >= o.weekStart &&
      j.scheduledAt < o.weekEnd
    )
      out.scheduledThisWeek.count++
    if (j.status === 'in_progress') out.inProgress.count++
    if (j.status === 'done') {
      const rest = remainingNetCents(j)
      if (rest > 0) {
        out.doneNotInvoiced.count++
        out.doneNotInvoiced.cents += rest
      }
    }
  }
  return out
}

/** Jobs awaiting approval longer than the window (the reminder job and the calendar). */
export function approvalOverdue(
  job: { status: string; quoteSentAt: Date | null; updatedAt: Date },
  now: Date,
  approvalReminderDays: number,
): boolean {
  if (job.status !== 'awaiting_approval') return false
  const since = job.quoteSentAt ?? job.updatedAt
  return now.getTime() - since.getTime() >= approvalReminderDays * 86_400_000
}

/** Date the reminder falls due: sent + N days (YYYY-MM-DD in UTC-agnostic date arithmetic). */
export function approvalDueAt(
  job: { quoteSentAt: Date | null; updatedAt: Date },
  approvalReminderDays: number,
): Date {
  const since = job.quoteSentAt ?? job.updatedAt
  return new Date(since.getTime() + approvalReminderDays * 86_400_000)
}
