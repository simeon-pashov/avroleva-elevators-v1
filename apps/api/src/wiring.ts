import { useScheduleRules } from './modules/registry/index.js'
import { scheduleRules } from './modules/maintenance/index.js'
import { useVisitRecorder } from './modules/callbacks/index.js'
import * as callbacks from './modules/callbacks/index.js'
import * as calendar from './modules/calendar/index.js'
import * as visits from './modules/visits/index.js'
import { checklists, usePlanSources } from './modules/maintenance/index.js'
import { useReportNotifier } from './modules/reporting/index.js'
import * as notifications from './modules/notifications/index.js'
import * as jobs from './modules/jobs/index.js'
import * as billing from './modules/billing/index.js'
import { systemCtx } from './platform/http/ctx.js'
import { toDateOnly } from './platform/clock.js'

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
  // maintenance (L3, step 9): the day plan reads open callbacks, scheduled repair jobs and
  // pending inspections through the PlanSources port; callbacks / jobs / calendar implement it.
  usePlanSources({
    openCallbacks: async (tenantId) =>
      (await callbacks.listOpenRows(tenantId)).map((c) => ({
        id: c.id,
        elevatorId: c.elevatorId,
        buildingId: c.buildingId,
        description: c.description,
        status: c.status,
        assignedUserId: c.assignedUserId,
      })),
    callback: async (tenantId, id) => {
      try {
        const c = await callbacks.get(systemCtx(tenantId), id)
        return {
          id: c.id,
          elevatorId: c.elevatorId,
          buildingId: c.buildingId,
          description: c.description,
          status: c.status,
          assignedUserId: c.assignedUserId,
        }
      } catch {
        return null
      }
    },
    jobsForPlanning: async (tenantId, q) =>
      (await jobs.listForPlanning(tenantId, q)).map((j) => ({
        id: j.id,
        elevatorId: j.elevatorId,
        buildingId: j.buildingId,
        title: j.title,
        status: j.status,
        scheduledAt: j.scheduledAt,
        assignedUserIds: j.assignedUserIds,
      })),
    scheduledInspections: async (tenantId) =>
      (await calendar.scheduledRows(tenantId)).map((i) => ({
        id: i.id,
        elevatorId: i.elevatorId,
        buildingId: i.elevator.building.id,
        scheduledAt: toDateOnly(i.scheduledAt),
        result: i.result,
      })),
    inspection: async (tenantId, id) => {
      try {
        const i = await calendar.get(systemCtx(tenantId), id)
        return {
          id: i.id,
          elevatorId: i.elevatorId,
          buildingId: i.buildingId,
          scheduledAt: i.scheduledAt,
          result: i.result,
        }
      } catch {
        return null
      }
    },
  })
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
  // billing (L3, step 9): the building's statement link goes out by e-mail / Viber through a port
  // declared by billing; notifications (L4) implements it.
  billing.useStatementLinkNotifier({
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
  })
}
