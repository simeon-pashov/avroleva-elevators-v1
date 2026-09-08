import { prismaBase as db } from '../../src/platform/db/prisma.js'
import { newId } from '../../src/platform/ids.js'
import * as notifications from '../../src/modules/notifications/index.js'
import { runFullExport, useReportNotifier } from '../../src/modules/reporting/index.js'

/**
 * Step 5 demo data: the default notification rules, a handful of delivery-log rows (in-app for
 * the office, one e-mail, one Viber link waiting to be sent, one skipped) and one completed full
 * export. Idempotent: rules are upserted only when missing; log rows and the export run only while
 * the tenant has none.
 */
export async function seedStep5(tenantId: string): Promise<Record<string, number>> {
  const counts = { notificationRules: 0, notifications: 0, exportRuns: 0 }
  counts.notificationRules = await notifications.ensureDefaultRules(tenantId)
  useReportNotifier({ sendEmail: notifications.sendEmail, notifyUsers: notifications.notifyUsers })

  if ((await db.notification.count({ where: { tenantId } })) === 0) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
    const users = await db.user.findMany({
      where: { tenantId, isActive: true, role: { in: ['owner', 'office'] } },
    })
    const callback = await db.callback.findFirst({
      where: { tenantId, status: { not: 'closed' } },
      include: { elevator: true, building: true },
      orderBy: { receivedAt: 'desc' },
    })
    const overdue = await db.invoice.findFirst({
      where: { tenantId, status: 'overdue' },
      include: { building: true },
      orderBy: { dueAt: 'asc' },
    })
    const visit = await db.visit.findFirst({
      where: { tenantId, kind: 'functional_check', checklist: { not: { equals: null } } },
      include: { elevator: true, building: true, technicians: true },
      orderBy: { startedAt: 'desc' },
    })
    const base = { tenant, link: '' }
    if (callback) {
      for (const u of users) {
        await notifications.send(tenantId, {
          key: 'callback_opened',
          channel: 'in_app',
          to: u.name,
          userId: u.id,
          locale: u.locale ?? tenant?.locale ?? 'bg',
          data: {
            ...base,
            building: { addressText: callback.building.addressText },
            elevator: { internalNo: callback.elevator.internalNo },
            callback: {
              receivedAt: callback.receivedAt.toISOString(),
              classificationLabel:
                callback.classification === 'trapped_persons' ? 'блокирани хора' : 'повреда',
              description: callback.description,
              trappedCount: callback.trappedCount,
              slaMinutes: callback.slaMinutes,
            },
          },
          eventType: 'CallbackOpened',
          relatedType: 'callback',
          relatedId: callback.id,
          link: '/callbacks',
        })
        counts.notifications++
      }
    }
    if (overdue) {
      for (const u of users) {
        await notifications.send(tenantId, {
          key: 'invoice_overdue',
          channel: 'in_app',
          to: u.name,
          userId: u.id,
          locale: u.locale ?? tenant?.locale ?? 'bg',
          data: {
            ...base,
            building: { addressText: overdue.building.addressText },
            invoice: {
              number: overdue.number,
              period: overdue.periodStart.toISOString().slice(0, 7),
              totalCents: overdue.totalCents,
              dueAt: overdue.dueAt.toISOString().slice(0, 10),
            },
          },
          eventType: 'InvoiceOverdue',
          relatedType: 'invoice',
          relatedId: overdue.id,
          link: `/buildings/${overdue.buildingId}`,
        })
        counts.notifications++
      }
    }
    if (visit) {
      const contacts = await db.contact.findMany({
        where: { tenantId, buildingId: visit.buildingId, deletedAt: null },
        orderBy: { isPrimary: 'desc' },
      })
      const withEmail = contacts.find((c) => c.email)
      const withPhone = contacts.find((c) => c.phone)
      const snap = visit.checklist as {
        summary?: { ok: number; defect: number; na: number }
      } | null
      const data = {
        ...base,
        building: { addressText: visit.building.addressText },
        elevator: { internalNo: visit.elevator.internalNo, regNo: visit.elevator.regNo },
        visit: {
          date: visit.startedAt.toISOString(),
          kindLabel: 'функционална проверка',
          technicians: visit.technicians.map((t) => t.name).join(', '),
          summary: snap?.summary ?? null,
          defects: '',
          notes: visit.notes ?? '',
          flags: '',
        },
      }
      if (withEmail) {
        const n = await notifications.send(tenantId, {
          key: 'visit_recorded',
          channel: 'email',
          to: withEmail.email!,
          locale: tenant?.locale ?? 'bg',
          data: { ...data, contact: { name: withEmail.name } },
          eventType: 'VisitRecorded',
          relatedType: 'visit',
          relatedId: visit.id,
        })
        // The console adapter "sent" it; mark the row so the log shows a delivered e-mail.
        await db.notification.update({
          where: { id: n.id },
          data: { status: 'sent', sentAt: new Date(), providerId: 'seed' },
        })
        counts.notifications++
      }
      if (withPhone) {
        await notifications.send(tenantId, {
          key: 'visit_recorded',
          channel: 'viber_link',
          to: withPhone.phone!,
          locale: tenant?.locale ?? 'bg',
          data: { ...data, contact: { name: withPhone.name } },
          eventType: 'VisitRecorded',
          relatedType: 'visit',
          relatedId: visit.id,
        })
        counts.notifications++
      }
      await db.notification.create({
        data: {
          id: newId(),
          tenantId,
          channel: 'email',
          to: '—',
          body: '',
          status: 'skipped',
          error: 'notifications.noEmail',
          eventType: 'CallbackClosed',
          relatedType: 'callback',
          relatedId: callback?.id ?? null,
        },
      })
      counts.notifications++
    }
  }

  if ((await db.exportJob.count({ where: { tenantId } })) === 0) {
    const owner = await db.user.findFirst({ where: { tenantId, role: 'owner' } })
    const job = await db.exportJob.create({
      data: { id: newId(), tenantId, kind: 'full', requestedByUserId: owner?.id ?? null },
    })
    await runFullExport(tenantId, job.id)
    counts.exportRuns = 1
  }
  return counts
}
