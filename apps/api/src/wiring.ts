import { useScheduleRules } from './modules/registry/index.js'
import { scheduleRules } from './modules/maintenance/index.js'
import { useVisitRecorder } from './modules/callbacks/index.js'
import * as visits from './modules/visits/index.js'
import { checklists } from './modules/maintenance/index.js'
import { useReportNotifier } from './modules/reporting/index.js'
import * as notifications from './modules/notifications/index.js'
import * as jobs from './modules/jobs/index.js'
import * as billing from './modules/billing/index.js'

let wired = false

/**
 * Composition root of the module ports (ARCHITECTURE section 1.1 rule 2): same-layer modules
 * reach each other only through ports declared by the caller and implemented here. Called by
 * `createApp()` and by the demo generator (which runs without the HTTP app from the seed), so
 * every entry point sees the same wiring. Idempotent.
 */
export function wireModules(): void {
  if (wired) return
  wired = true
  // The registry's schedule port gets the maintenance module's cycle engine; nothing below L3
  // imports maintenance directly.
  useScheduleRules(scheduleRules)
  // callbacks (L3) records its close-out visit through a port; visits (L3) implements it.
  useVisitRecorder({ record: visits.record })
  // visits (L3) snapshots checklist answers through a port; maintenance (L3) owns the templates.
  visits.useChecklistResolver({ snapshotFor: checklists.snapshotFor })
  // reporting (L4) e-mails reports / export links through a port; notifications (L4) implements it.
  useReportNotifier({ sendEmail: notifications.sendEmail, notifyUsers: notifications.notifyUsers })
  // jobs (L3, step 8): the repair visit (visits, L3), the invoice (billing, L3) and the quote
  // e-mail / Viber link / office reminder (notifications, L4) all go through ports declared by jobs.
  jobs.useVisitRecorder({ record: visits.record })
  jobs.useInvoiceIssuer({
    issue: async (ctx, input) => {
      const inv = await billing.issueInvoice(ctx, input)
      return {
        id: inv.id,
        number: inv.number,
        totalCents: inv.totalCents,
        openCents: inv.openCents,
        status: inv.status,
        issuedAt: inv.issuedAt,
      }
    },
    listForSource: (ctx, sourceType, sourceId) => billing.listForSource(ctx, sourceType, sourceId),
  })
  jobs.useQuoteNotifier({
    sendEmail: (tenantId, input) => notifications.sendEmail(tenantId, input),
    viberLink: async (tenantId, input) => {
      const n = await notifications.send(tenantId, {
        key: input.key,
        channel: 'viber_link',
        to: input.phone,
        locale: input.locale ?? 'bg',
        data: input.data,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      })
      return { id: n.id, url: n.viber?.forwardUrl ?? '', text: n.body }
    },
    notifyOffice: async (tenantId, input) => {
      await notifications.notifyUsers(tenantId, {
        key: input.key,
        roles: ['owner', 'office'],
        data: input.data,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        link: input.link,
        eventId: input.eventId,
        eventType: input.eventType,
      })
    },
  })
}
