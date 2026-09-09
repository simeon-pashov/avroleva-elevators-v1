import type {
  InboxDto,
  NotificationChannel,
  NotificationDto,
  NotificationListQuery,
  NotificationRuleDto,
  NotificationTemplateDto,
  Page,
  PreviewTemplateBody,
  RecipientKind,
  RenderedNotificationDto,
  TestSendBody,
  UpdateRuleBody,
  UpsertTemplateBody,
  ViberLinkDto,
} from '@avroleva/contracts'
import { listNotificationTemplates } from '@avroleva/domain-data'
import { createT, resolveLocale } from '@avroleva/i18n'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf, systemCtx } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import { adapters } from '../../platform/adapters/index.js'
import { clock, todayInSofia } from '../../platform/clock.js'
import { logger } from '../../platform/logger.js'
import { urls } from '../../platform/urls.js'
import { config } from '../../platform/config.js'
import { enqueue } from '../../platform/jobs/boss.js'
import { defineJob } from '../../platform/jobs/registry.js'
import type { PublishedEvent } from '../../platform/events/bus.js'
import type { EmailAttachment } from '../../platform/ports/notifications.js'
import { getTenant, getTenantSettings, listNotifiableUsers } from '../tenancy/index.js'
import { buildings, contacts as contactsApi, elevators } from '../registry/index.js'
import * as visits from '../visits/index.js'
import * as callbacks from '../callbacks/index.js'
import * as billing from '../billing/index.js'
import * as defects from '../defects/index.js'
import { channelFallbacks, renderText, textToHtml, validateTemplate } from './domain/templates.js'
import type { TemplateText } from './domain/templates.js'
import {
  defaultRules,
  matchRules,
  officeRoles,
  parseRuleConfig,
  sampleData,
  templateKeyFor,
} from './domain/rules.js'
import * as repo from './repo/notifications.js'
import type { NotificationRow, RuleRow, TemplateRow } from './repo/notifications.js'

export const DELIVER_JOB = 'notifications.deliver'
const MAX_SEND_ATTEMPTS = 3

// ---- DTOs -------------------------------------------------------------------------------------

export function toRuleDto(r: RuleRow): NotificationRuleDto {
  return {
    id: r.id,
    eventType: r.eventType as NotificationRuleDto['eventType'],
    channel: r.channel,
    recipientKind: r.recipientKind,
    enabled: r.enabled,
    config: parseRuleConfig(r.config),
    updatedAt: r.updatedAt.toISOString(),
  }
}

export function toTemplateDto(t: TemplateRow): NotificationTemplateDto {
  return {
    id: t.id,
    tenantId: t.tenantId,
    key: t.key,
    channel: t.channel,
    locale: t.locale,
    subject: t.subject,
    body: t.body,
    updatedAt: t.updatedAt.toISOString(),
  }
}

export function toNotificationDto(n: NotificationRow): NotificationDto {
  const meta = (n.meta ?? null) as { viber?: ViberLinkDto } | null
  return {
    id: n.id,
    ruleId: n.ruleId,
    eventType: n.eventType,
    channel: n.channel,
    to: n.to,
    userId: n.userId,
    subject: n.subject,
    body: n.body,
    status: n.status,
    providerId: n.providerId,
    error: n.error,
    relatedType: n.relatedType,
    relatedId: n.relatedId,
    link: n.link,
    viber: n.channel === 'viber_link' && meta?.viber ? meta.viber : null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    sentAt: n.sentAt ? n.sentAt.toISOString() : null,
  }
}

// ---- Seeds ------------------------------------------------------------------------------------

/** System templates (tenantId NULL) from packages/domain-data - every deployment, idempotent. */
export async function ensureSystemTemplates(): Promise<Record<string, number>> {
  const counts = { created: 0, updated: 0, unchanged: 0 }
  for (const t of listNotificationTemplates()) {
    counts[await repo.upsertSystemTemplate({ ...t, channel: t.channel })]++
  }
  return counts
}

/** Default rule set for a tenant; existing rows are never overwritten (idempotent). */
export async function ensureDefaultRules(tenantId: string): Promise<number> {
  let created = 0
  const before = await repo.countRules(tenantId)
  for (const r of defaultRules()) {
    await repo.upsertRule(
      tenantId,
      { eventType: r.eventType, channel: r.channel, recipientKind: r.recipientKind },
      { enabled: r.enabled, config: r.config },
      true,
    )
  }
  created = (await repo.countRules(tenantId)) - before
  return created
}

// ---- Templates --------------------------------------------------------------------------------

async function resolveTemplate(
  tenantId: string,
  key: string,
  channel: NotificationChannel,
  locale: string,
): Promise<TemplateText | null> {
  const rows = await repo.templatesFor(tenantId, key)
  for (const ch of channelFallbacks(channel)) {
    for (const loc of [locale, 'bg', 'en']) {
      const tenantRow = rows.find(
        (r) => r.tenantId === tenantId && r.channel === ch && r.locale === loc,
      )
      const sysRow = rows.find((r) => r.tenantId === null && r.channel === ch && r.locale === loc)
      const row = tenantRow ?? sysRow
      if (row) return { subject: row.subject, body: row.body }
    }
  }
  return null
}

export async function listTemplates(ctx: Ctx): Promise<NotificationTemplateDto[]> {
  return (await repo.listTemplates(ctx.tenantId)).map(toTemplateDto)
}

export async function upsertTemplate(
  ctx: Ctx,
  key: string,
  channel: NotificationChannel,
  locale: string,
  body: UpsertTemplateBody,
): Promise<NotificationTemplateDto> {
  const err = validateTemplate(body.body) ?? (body.subject ? validateTemplate(body.subject) : null)
  if (err) throw new AppError(400, 'notifications.templateInvalid', { detail: err })
  const row = await repo.upsertTenantTemplate(ctx.tenantId, {
    key,
    channel,
    locale: resolveLocale(locale),
    subject: body.subject ?? null,
    body: body.body,
  })
  await audit(actorOf(ctx), {
    action: 'notification.template.upsert',
    entityType: 'notification_template',
    entityId: row.id,
  })
  return toTemplateDto(row)
}

export async function resetTemplate(
  ctx: Ctx,
  key: string,
  channel: NotificationChannel,
  locale: string,
): Promise<void> {
  const removed = await repo.removeTenantTemplate(ctx.tenantId, key, channel, locale, clock.now())
  if (!removed) throw notFound()
  await audit(actorOf(ctx), {
    action: 'notification.template.reset',
    entityType: 'notification_template',
    entityId: `${key}/${channel}/${locale}`,
  })
}

export async function preview(
  ctx: Ctx,
  body: PreviewTemplateBody,
): Promise<RenderedNotificationDto> {
  const locale = resolveLocale(body.locale, ctx.locale)
  const tenant = await getTenant(ctx.tenantId)
  const sample = { ...sampleData(locale), tenant: { ...tenant, name: tenant.name } }
  let template: TemplateText | null
  if (body.body !== undefined) {
    template = { subject: body.subject ?? null, body: body.body }
    const err = validateTemplate(template.body)
    if (err) throw new AppError(400, 'notifications.templateInvalid', { detail: err })
  } else {
    template = await resolveTemplate(ctx.tenantId, body.key, body.channel, locale)
    if (!template) throw notFound('notifications.templateMissing')
  }
  const rendered = renderText(template, sample, locale)
  return { ...rendered, sample }
}

// ---- Rules ------------------------------------------------------------------------------------

export async function listRules(ctx: Ctx): Promise<NotificationRuleDto[]> {
  await ensureDefaultRules(ctx.tenantId)
  return (await repo.listRules(ctx.tenantId)).map(toRuleDto)
}

export async function upsertRule(
  ctx: Ctx,
  key: { eventType: string; channel: NotificationChannel; recipientKind: RecipientKind },
  body: UpdateRuleBody,
): Promise<NotificationRuleDto> {
  const row = await repo.upsertRule(ctx.tenantId, key, {
    enabled: body.enabled,
    ...(body.config !== undefined ? { config: body.config } : {}),
  })
  await audit(actorOf(ctx), {
    action: 'notification.rule.upsert',
    entityType: 'notification_rule',
    entityId: row.id,
    after: { ...key, enabled: row.enabled, config: row.config },
  })
  return toRuleDto(row)
}

// ---- Sending ----------------------------------------------------------------------------------

export interface SendInput {
  key: string
  channel: NotificationChannel
  /** e-mail address, phone, or the user's name for in_app. */
  to: string
  userId?: string | null
  locale: string
  data: Record<string, unknown>
  ruleId?: string | null
  eventId?: string | null
  eventType?: string | null
  relatedType?: string | null
  relatedId?: string | null
  /** Office deep link (BASE_PATH-relative, e.g. "/callbacks"). */
  link?: string | null
  attachments?: EmailAttachment[]
  html?: string
}

/**
 * Renders the template for (key, channel, locale), writes the delivery-log row and hands it to
 * the channel: in_app = done, viber_link = the office user sends it by hand (row stays queued
 * with the links in `meta`), email/sms = a `notifications.deliver` job.
 */
export async function send(tenantId: string, input: SendInput): Promise<NotificationDto> {
  const template = await resolveTemplate(tenantId, input.key, input.channel, input.locale)
  if (!template) throw new AppError(500, 'notifications.templateMissing', { detail: input.key })
  const rendered = renderText(template, input.data, input.locale)
  const now = clock.now()
  let meta: Record<string, unknown> | undefined
  let status: NotificationRow['status'] = 'queued'
  let sentAt: Date | null = null
  if (input.channel === 'in_app') {
    status = 'sent'
    sentAt = now
  } else if (input.channel === 'viber_link') {
    meta = { viber: adapters.viber.build(input.to, rendered.body) }
  } else if (input.channel === 'email') {
    meta = {
      ...(input.html ? { html: input.html } : {}),
      ...(input.attachments
        ? {
            attachments: input.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
              encoding: Buffer.isBuffer(a.content) ? 'base64' : 'utf8',
            })),
          }
        : {}),
    }
  }
  const row = await repo.createNotification(tenantId, {
    ruleId: input.ruleId ?? null,
    eventId: input.eventId ?? null,
    eventType: input.eventType ?? null,
    channel: input.channel,
    to: input.to,
    userId: input.userId ?? null,
    subject: rendered.subject,
    body: rendered.body,
    status,
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
    link: input.link ?? null,
    meta: meta as never,
    sentAt,
  })
  if (input.channel === 'email' || input.channel === 'sms') {
    await enqueue(DELIVER_JOB, { tenantId, id: row.id }, { singletonKey: `deliver:${row.id}` })
  }
  return toNotificationDto(row)
}

/** Job handler: one queued e-mail / SMS row -> the adapter. Throws to let pg-boss retry. */
export async function deliver(
  tenantId: string,
  id: string,
): Promise<'sent' | 'skipped' | 'failed'> {
  const n = await repo.findNotification(tenantId, id)
  if (!n || n.status !== 'queued') return 'skipped'
  if (n.channel !== 'email' && n.channel !== 'sms') return 'skipped'
  const attempts = n.attempts + 1
  try {
    let providerId: string | undefined
    if (n.channel === 'email') {
      const tenant = await getTenant(tenantId)
      const meta = (n.meta ?? {}) as {
        html?: string
        attachments?: Array<{
          filename: string
          contentType: string
          content: string
          encoding: string
        }>
      }
      const r = await adapters.email.send({
        to: n.to,
        subject: n.subject ?? tenant.name,
        text: n.body,
        html: meta.html ?? textToHtml(n.body),
        fromName: tenant.name,
        replyTo: tenant.email ?? undefined,
        attachments: meta.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.encoding === 'base64' ? Buffer.from(a.content, 'base64') : a.content,
        })),
      })
      providerId = r.providerMessageId
    } else {
      const r = await adapters.sms.send({ to: n.to, text: n.body })
      providerId = r.providerMessageId
    }
    await repo.updateNotification(tenantId, id, {
      status: 'sent',
      sentAt: clock.now(),
      providerId: providerId ?? null,
      attempts,
      error: null,
    })
    return 'sent'
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 1000)
    const final = attempts >= MAX_SEND_ATTEMPTS
    await repo.updateNotification(tenantId, id, {
      attempts,
      error: message,
      ...(final ? { status: 'failed' } : {}),
    })
    logger.warn({ err, id, attempts }, 'notification send failed')
    if (!final) throw err
    return 'failed'
  }
}

/** Office: the Viber text was sent by hand from the phone. */
export async function markSent(ctx: Ctx, id: string): Promise<NotificationDto> {
  const n = await repo.findNotification(ctx.tenantId, id)
  if (!n) throw notFound()
  if (n.channel !== 'viber_link' || n.status === 'sent')
    throw new AppError(409, 'notifications.notMarkable')
  await repo.updateNotification(ctx.tenantId, id, { status: 'sent', sentAt: clock.now() })
  const updated = await repo.findNotification(ctx.tenantId, id)
  return toNotificationDto(updated!)
}

export function viberLink(phone: string, text: string): ViberLinkDto {
  return adapters.viber.build(phone, text)
}

/** Re-queues e-mail / SMS rows stuck in `queued` (worker was down while they were created). */
export async function requeueStuck(olderThanMinutes = 10): Promise<number> {
  const rows = await repo.listStuckQueued(
    new Date(clock.now().getTime() - olderThanMinutes * 60_000),
  )
  for (const r of rows) {
    await enqueue(
      DELIVER_JOB,
      { tenantId: r.tenantId, id: r.id },
      { singletonKey: `deliver:${r.id}` },
    )
  }
  return rows.length
}

// ---- Log and inbox ----------------------------------------------------------------------------

export async function log(ctx: Ctx, q: NotificationListQuery): Promise<Page<NotificationDto>> {
  const rows = await repo.listLog(ctx.tenantId, q)
  const items = rows.slice(0, q.limit)
  return {
    items: items.map(toNotificationDto),
    nextCursor: rows.length > q.limit ? repo.cursorOf(items[items.length - 1]!) : null,
  }
}

export async function inbox(ctx: Ctx, limit = 30): Promise<InboxDto> {
  const [rows, unread] = await Promise.all([
    repo.inbox(ctx.tenantId, ctx.userId, limit),
    repo.unreadCount(ctx.tenantId, ctx.userId),
  ])
  return { unread, items: rows.map(toNotificationDto) }
}

export async function markRead(ctx: Ctx, ids: string[] | null): Promise<number> {
  const r = await repo.markRead(ctx.tenantId, ctx.userId, ids, clock.now())
  return r.count
}

export function countForTenant(tenantId: string): Promise<number> {
  return repo.countNotifications(tenantId)
}

// ---- Test send (settings page) ---------------------------------------------------------------

export async function testSend(ctx: Ctx, body: TestSendBody): Promise<NotificationDto> {
  const tenant = await getTenant(ctx.tenantId)
  const locale = ctx.locale
  const users = await listNotifiableUsers(ctx.tenantId)
  const me = users.find((u) => u.id === ctx.userId)
  const to =
    body.channel === 'in_app'
      ? (me?.name ?? ctx.userId)
      : (body.to ?? (body.channel === 'email' ? (me?.email ?? '') : (me?.phone ?? '')))
  if (!to) throw new AppError(400, 'notifications.noRecipient')
  const data = { ...sampleData(locale), tenant, user: { name: me?.name ?? '' } }
  return send(ctx.tenantId, {
    key: body.key,
    channel: body.channel,
    to,
    userId: body.channel === 'in_app' ? ctx.userId : null,
    locale,
    data,
    relatedType: 'test',
    link: null,
  })
}

// ---- Convenience senders for other L4 modules (reporting, exports) and tenancy events ----------

export interface NotifyUsersInput {
  key: string
  roles?: ReadonlyArray<'owner' | 'office' | 'technician'>
  userIds?: string[]
  data: Record<string, unknown>
  relatedType?: string | null
  relatedId?: string | null
  link?: string | null
  eventId?: string | null
  eventType?: string | null
  channel?: 'in_app' | 'email'
}

/** In-app (default) or e-mail to the tenant's users by role or id. Returns the rows written. */
export async function notifyUsers(
  tenantId: string,
  input: NotifyUsersInput,
): Promise<NotificationDto[]> {
  const tenant = await getTenant(tenantId)
  const users = (await listNotifiableUsers(tenantId)).filter(
    (u) =>
      (input.userIds ? input.userIds.includes(u.id) : true) &&
      (input.roles ? input.roles.includes(u.role as 'owner') : true),
  )
  const out: NotificationDto[] = []
  const channel = input.channel ?? 'in_app'
  for (const u of users) {
    const to = channel === 'email' ? u.email : u.name
    if (!to) continue
    if (input.eventId && (await repo.existsForEvent(tenantId, input.eventId, channel, to))) continue
    out.push(
      await send(tenantId, {
        key: input.key,
        channel,
        to,
        userId: u.id,
        locale: resolveLocale(u.locale, tenant.locale),
        data: { ...input.data, tenant, user: { name: u.name } },
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        link: input.link,
        eventId: input.eventId,
        eventType: input.eventType,
      }),
    )
  }
  return out
}

export interface SendEmailInput {
  key: string
  to: string
  data: Record<string, unknown>
  relatedType?: string | null
  relatedId?: string | null
  attachments?: EmailAttachment[]
  html?: string
  locale?: string
}

/** One e-mail through a template (the tenant object is injected). */
export async function sendEmail(tenantId: string, input: SendEmailInput): Promise<NotificationDto> {
  const tenant = await getTenant(tenantId)
  return send(tenantId, {
    key: input.key,
    channel: 'email',
    to: input.to,
    locale: resolveLocale(input.locale, tenant.locale),
    data: { ...input.data, tenant },
    relatedType: input.relatedType,
    relatedId: input.relatedId,
    attachments: input.attachments,
    html: input.html,
  })
}

// ---- The event subscriber (ARCHITECTURE A8): rules decide, templates render -----------------

interface EventContextData {
  data: Record<string, unknown>
  buildingId: string | null
  elevatorId: string | null
  assignedUserId: string | null
  relatedType: string
  relatedId: string
  link: string | null
}

function officeLink(path: string): string {
  return path
}

async function contextFor(
  tenantId: string,
  locale: string,
  event: PublishedEvent,
): Promise<EventContextData | null> {
  const ctx = systemCtx(tenantId, locale)
  const t = createT(locale)
  const tenant = await getTenant(tenantId)
  const p = event.payload
  const base = { tenant, link: urls.base() }
  switch (event.type) {
    case 'VisitRecorded': {
      const v = await visits.get(ctx, event.aggregateId)
      const e = await elevators.get(ctx, v.elevatorId)
      const defectsFound = (v.checklist?.items ?? [])
        .filter((i) => i.result === 'defect')
        .map((i) => (locale === 'en' ? i.label.en : i.label.bg))
      const flags = v.qualityFlags.map((f) => t(`visits.flag.${f}`)).join(', ')
      return {
        data: {
          ...base,
          building: {
            id: e.buildingId,
            addressText: e.buildingAddressText,
            customerName: e.customerName,
          },
          elevator: { internalNo: e.internalNo, regNo: e.regNo },
          visit: {
            date: v.startedAt,
            kindLabel: t(`enum.visitKind.${v.kind}`).toLowerCase(),
            technicians: v.technicians.map((x) => x.name).join(', '),
            summary: v.checklist?.summary ?? null,
            defects: defectsFound.join('; '),
            notes: v.notes ?? '',
            flags,
          },
        },
        buildingId: e.buildingId,
        elevatorId: e.id,
        assignedUserId: null,
        relatedType: 'visit',
        relatedId: v.id,
        link: officeLink(`/elevators/${e.id}`),
      }
    }
    case 'CallbackOpened':
    case 'CallbackClosed':
    case 'CallbackSlaAtRisk':
    case 'CallbackSlaBreached': {
      const c = await callbacks.get(ctx, event.aggregateId)
      return {
        data: {
          ...base,
          building: { id: c.buildingId, addressText: c.buildingAddressText },
          elevator: { internalNo: c.elevatorInternalNo },
          callback: {
            receivedAt: c.receivedAt,
            classificationLabel: t(`enum.callbackClassification.${c.classification}`).toLowerCase(),
            description: c.description,
            trappedCount: c.trappedCount,
            responseMinutes: c.responseMinutes,
            elapsedMinutes:
              typeof p.elapsedMinutes === 'number' ? p.elapsedMinutes : c.elapsedMinutes,
            slaMinutes: c.slaMinutes,
            cause: c.cause ?? '',
            actionTaken: c.actionTaken ?? '',
            status: c.status,
          },
        },
        buildingId: c.buildingId,
        elevatorId: c.elevatorId,
        assignedUserId: c.assignedUserId,
        relatedType: 'callback',
        relatedId: c.id,
        link: officeLink('/callbacks'),
      }
    }
    case 'InvoiceIssued':
    case 'InvoiceOverdue':
    case 'DunningStageReached':
    case 'CreditNoteIssued': {
      const inv = await billing.get(ctx, event.aggregateId)
      const settings = await getTenantSettings(tenantId)
      const bank = billing.bankDetailsOf(settings, tenant.name)
      const daysOverdue =
        typeof p.dueAt === 'string'
          ? Math.max(0, Math.round((Date.parse(todayInSofia()) - Date.parse(p.dueAt)) / 86_400_000))
          : inv.daysOverdue
      return {
        data: {
          ...base,
          building: { id: inv.buildingId, addressText: inv.buildingAddressText ?? '' },
          elevator: { internalNo: '' },
          invoice: {
            number: inv.number,
            paymentReference: inv.paymentReference,
            period: inv.period,
            totalCents: inv.totalCents,
            openCents: inv.openCents,
            dueAt: inv.dueAt,
          },
          bank: bank ?? { iban: '' },
          dunning: {
            stageKey: p.stageKey ?? null,
            daysOverdue,
            lateFeeCents: typeof p.lateFeeCents === 'number' ? p.lateFeeCents : 0,
          },
          creditNote: {
            number: p.number ?? null,
            totalCents: typeof p.totalCents === 'number' ? p.totalCents : 0,
            reason: p.reason ?? '',
          },
        },
        buildingId: inv.buildingId,
        elevatorId: null,
        assignedUserId: null,
        relatedType: 'invoice',
        relatedId: inv.id,
        link: officeLink(`/invoices/${inv.id}`),
      }
    }
    case 'PaymentMatched': {
      const invoiceId = typeof p.invoiceId === 'string' ? p.invoiceId : null
      const inv = invoiceId ? await billing.get(ctx, invoiceId) : null
      const buildingId = String(p.buildingId ?? inv?.buildingId ?? '')
      const b = buildingId ? await buildings.find(tenantId, buildingId) : null
      const source = String(p.source ?? 'manual')
      return {
        data: {
          ...base,
          building: {
            id: buildingId,
            addressText: b?.addressText ?? inv?.buildingAddressText ?? '',
          },
          elevator: { internalNo: '' },
          invoice: inv
            ? {
                number: inv.number,
                paymentReference: inv.paymentReference,
                openCents: inv.openCents,
              }
            : { number: null },
          payment: {
            amountCents: typeof p.amountCents === 'number' ? p.amountCents : 0,
            source,
            sourceLabel: t(`enum.paymentSource.${source}`),
            provider: p.provider ?? null,
            reference: p.reference ?? null,
            settled: p.settled === true,
          },
        },
        buildingId: buildingId || null,
        elevatorId: null,
        assignedUserId: null,
        relatedType: inv ? 'invoice' : 'payment',
        relatedId: inv ? inv.id : event.aggregateId,
        link: officeLink(inv ? `/invoices/${inv.id}` : `/buildings/${buildingId}`),
      }
    }
    case 'InspectionDueSoon':
    case 'CheckOverdue': {
      const e = await elevators.get(ctx, event.aggregateId)
      return {
        data: {
          ...base,
          building: {
            id: e.buildingId,
            addressText: e.buildingAddressText,
            customerName: e.customerName,
          },
          elevator: { internalNo: e.internalNo, regNo: e.regNo },
          inspection: { dueAt: p.dueAt ?? null, inDays: p.inDays ?? null },
          check: { dueAt: p.dueAt ?? null, overdueDays: p.overdueDays ?? null },
        },
        buildingId: e.buildingId,
        elevatorId: e.id,
        assignedUserId: null,
        relatedType: 'elevator',
        relatedId: e.id,
        link: officeLink(event.type === 'CheckOverdue' ? `/elevators/${e.id}` : '/calendar'),
      }
    }
    case 'DefectFollowUpDue':
    case 'StopLiftRequired': {
      const d = await defects.get(ctx, event.aggregateId)
      return {
        data: {
          ...base,
          building: { id: d.buildingId, addressText: d.buildingAddressText },
          elevator: { internalNo: d.elevatorInternalNo },
          defect: {
            description: d.catalogRef ? `${d.catalogRef} · ${d.description}` : d.description,
            recordedAt: d.recordedAt,
            followUpDueAt: d.followUpDueAt,
          },
        },
        buildingId: d.buildingId,
        elevatorId: d.elevatorId,
        assignedUserId: null,
        relatedType: 'defect',
        relatedId: d.id,
        link: officeLink('/defects'),
      }
    }
    default:
      return null
  }
}

interface ContactPick {
  name: string
  email: string | null
  phone: string | null
  hasViber: boolean
}

async function buildingContacts(tenantId: string, buildingId: string): Promise<ContactPick[]> {
  const page = await contactsApi.list(systemCtx(tenantId), { buildingId, limit: 50 })
  return page.items.map((c) => ({
    name: c.name,
    email: c.email,
    phone: c.phone,
    hasViber: c.hasViber,
  }))
}

/**
 * Subscriber for every notifiable event. For each enabled rule: resolve recipients, render, log,
 * hand to the channel. Idempotent per (event, channel, recipient) so a redelivery is harmless.
 */
export async function handleEvent(event: PublishedEvent): Promise<void> {
  if (!event.tenantId) return
  const tenantId = event.tenantId
  const rules = matchRules(
    await repo.rulesForEvent(tenantId, event.type),
    event.type,
    event.payload,
  )
  if (rules.length === 0) return
  const tenant = await getTenant(tenantId)
  const locale = resolveLocale(tenant.locale)
  const cx = await contextFor(tenantId, locale, event)
  if (!cx) return
  // Dunning as data (ADR 0001): the stage row names the template and the contact channel.
  const stageTemplate =
    event.type === 'DunningStageReached' && typeof event.payload.templateKey === 'string'
      ? event.payload.templateKey
      : null
  const stageChannel =
    event.type === 'DunningStageReached' && typeof event.payload.channel === 'string'
      ? (event.payload.channel as NotificationChannel)
      : null
  const key = stageTemplate ?? templateKeyFor(event.type)
  const users = await listNotifiableUsers(tenantId)
  const contacts = cx.buildingId ? await buildingContacts(tenantId, cx.buildingId) : []

  for (const rule of rules) {
    // A building-contact rule fires only on the stage's channel (in_app stages reach the office only).
    if (stageChannel && rule.recipientKind === 'building_contact' && rule.channel !== stageChannel)
      continue
    const common = {
      key,
      ruleId: rule.id,
      eventId: event.id,
      eventType: event.type,
      relatedType: cx.relatedType,
      relatedId: cx.relatedId,
      link: cx.link,
    }
    const cfg = parseRuleConfig(rule.config)
    try {
      if (rule.recipientKind === 'building_contact') {
        if (contacts.length === 0) {
          await skipped(tenantId, common, rule.channel, 'notifications.noContact')
          continue
        }
        const primary = contacts[0]!
        if (rule.channel === 'email') {
          const c = contacts.find((x) => x.email) ?? null
          if (c) {
            await sendOnce(tenantId, {
              ...common,
              channel: 'email',
              to: c.email!,
              locale,
              data: withContact(cx.data, c),
            })
          } else if (cfg.fallbackViberLink && contacts.some((x) => x.phone)) {
            const v = contacts.find((x) => x.hasViber && x.phone) ?? contacts.find((x) => x.phone)!
            await sendOnce(tenantId, {
              ...common,
              channel: 'viber_link',
              to: v.phone!,
              locale,
              data: withContact(cx.data, v),
            })
          } else {
            await skipped(tenantId, common, rule.channel, 'notifications.noEmail', primary.name)
          }
        } else if (rule.channel === 'sms' || rule.channel === 'viber_link') {
          const c =
            rule.channel === 'viber_link'
              ? (contacts.find((x) => x.hasViber && x.phone) ?? contacts.find((x) => x.phone))
              : contacts.find((x) => x.phone)
          if (c)
            await sendOnce(tenantId, {
              ...common,
              channel: rule.channel,
              to: c.phone!,
              locale,
              data: withContact(cx.data, c),
            })
          else await skipped(tenantId, common, rule.channel, 'notifications.noPhone', primary.name)
        } else {
          await skipped(tenantId, common, rule.channel, 'notifications.channelNotForContacts')
        }
        continue
      }
      let targets = users
      if (rule.recipientKind === 'assigned_technician') {
        targets = cx.assignedUserId ? users.filter((u) => u.id === cx.assignedUserId) : []
      } else {
        const roles = officeRoles(rule.recipientKind)
        targets = users.filter((u) => roles.includes(u.role as 'owner'))
      }
      for (const u of targets) {
        const to = rule.channel === 'in_app' ? u.name : rule.channel === 'email' ? u.email : u.phone
        if (!to) continue
        await sendOnce(tenantId, {
          ...common,
          channel: rule.channel,
          to,
          userId: u.id,
          locale: resolveLocale(u.locale, tenant.locale),
          data: { ...cx.data, user: { name: u.name } },
        })
      }
    } catch (err) {
      logger.error({ err, ruleId: rule.id, eventId: event.id }, 'notification rule failed')
    }
  }
}

function withContact(data: Record<string, unknown>, c: ContactPick): Record<string, unknown> {
  return { ...data, contact: { name: c.name, phone: c.phone ?? '', email: c.email ?? '' } }
}

async function sendOnce(tenantId: string, input: SendInput): Promise<void> {
  if (
    input.eventId &&
    (await repo.existsForEvent(tenantId, input.eventId, input.channel, input.to))
  )
    return
  await send(tenantId, input)
}

async function skipped(
  tenantId: string,
  common: {
    key: string
    ruleId: string
    eventId: string
    eventType: string
    relatedType: string
    relatedId: string
    link: string | null
  },
  channel: NotificationChannel,
  reason: string,
  to = '—',
): Promise<void> {
  if (await repo.existsForEvent(tenantId, common.eventId, channel, to)) return
  await repo.createNotification(tenantId, {
    ...common,
    channel,
    to,
    body: '',
    status: 'skipped',
    error: reason,
  })
}

// ---- Job registration --------------------------------------------------------------------------

defineJob<{ tenantId: string; id: string }>({
  name: DELIVER_JOB,
  description: 'Sends one queued e-mail / SMS notification through the configured adapter.',
  retryLimit: MAX_SEND_ATTEMPTS - 1,
  retryDelaySeconds: 30,
  expireInSeconds: 60,
  handler: async (data) => ({ result: await deliver(data.tenantId, data.id) }),
})

/** Base path for links rendered into e-mails. */
export function publicBase(): string {
  return config.BASE_PATH === '/' ? '' : config.BASE_PATH
}
