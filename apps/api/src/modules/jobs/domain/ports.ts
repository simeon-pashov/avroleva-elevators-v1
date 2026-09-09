import type {
  CreateVisitBody,
  InvoiceLineDto,
  JobInvoiceRefDto,
  VisitDto,
} from '@avroleva/contracts'
import type { Ctx } from '../../../platform/http/ctx.js'

/**
 * Ports declared by the caller (ARCHITECTURE section 1.1 rule 2). jobs (L3) needs three things
 * it must not import directly: the visit record (visits, L3), an invoice (billing, L3) and a way
 * to send a quote or a reminder (notifications, L4). `app.ts` wires the real implementations.
 */
export interface VisitRecorder {
  record(ctx: Ctx, body: CreateVisitBody): Promise<VisitDto>
}

export interface InvoiceIssuer {
  issue(
    ctx: Ctx,
    input: {
      sourceType: 'job'
      sourceId: string
      buildingId: string
      customerId: string
      lines: InvoiceLineDto[]
      issuedAt?: string
      dueAt?: string
    },
  ): Promise<JobInvoiceRefDto>
  /** Invoices created from a job (by source), for the detail view. */
  listForSource(ctx: Ctx, sourceType: 'job', sourceId: string): Promise<JobInvoiceRefDto[]>
}

export interface QuoteNotifier {
  /** E-mail with the quote document attached; returns the notification row id. */
  sendEmail(
    tenantId: string,
    input: {
      key: string
      to: string
      data: Record<string, unknown>
      relatedType: string
      relatedId: string
      attachments?: Array<{ filename: string; content: string; contentType: string }>
      locale?: string
    },
  ): Promise<{ id: string }>
  /** Viber deep link with the rendered text (the office user sends it by hand). */
  viberLink(
    tenantId: string,
    input: {
      key: string
      phone: string
      data: Record<string, unknown>
      relatedType: string
      relatedId: string
      locale?: string
    },
  ): Promise<{ id: string; url: string; text: string }>
  /** In-app reminder to the office users. */
  notifyOffice(
    tenantId: string,
    input: {
      key: string
      data: Record<string, unknown>
      relatedType: string
      relatedId: string
      link: string
      eventId?: string | null
      eventType?: string | null
    },
  ): Promise<void>
}

let recorder: VisitRecorder | null = null
let issuer: InvoiceIssuer | null = null
let notifier: QuoteNotifier | null = null

export function useVisitRecorder(r: VisitRecorder): void {
  recorder = r
}
export function useInvoiceIssuer(i: InvoiceIssuer): void {
  issuer = i
}
export function useQuoteNotifier(n: QuoteNotifier): void {
  notifier = n
}

export function visitRecorder(): VisitRecorder {
  if (!recorder) throw new Error('jobs.VisitRecorder not wired (app.ts)')
  return recorder
}
export function invoiceIssuer(): InvoiceIssuer {
  if (!issuer) throw new Error('jobs.InvoiceIssuer not wired (app.ts)')
  return issuer
}
export function quoteNotifier(): QuoteNotifier | null {
  return notifier
}
