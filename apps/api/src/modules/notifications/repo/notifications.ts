import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type {
  Notification,
  NotificationChannel,
  NotificationRule,
  NotificationStatus,
  NotificationTemplate,
  Prisma,
  RecipientKind,
} from '../../../generated/prisma/index.js'

export type TemplateRow = NotificationTemplate
export type RuleRow = NotificationRule
export type NotificationRow = Notification

// ---- templates (system rows tenantId NULL + tenant overrides) -------------------------------

/** System + tenant rows for a key (tenant rows first so the caller can prefer them). */
export function templatesFor(tenantId: string, key: string): Promise<TemplateRow[]> {
  return prismaBase.notificationTemplate.findMany({
    where: { key, active: true, deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
    orderBy: [{ tenantId: { sort: 'desc', nulls: 'last' } }],
  })
}

export function listTemplates(tenantId: string): Promise<TemplateRow[]> {
  return prismaBase.notificationTemplate.findMany({
    where: { active: true, deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
    orderBy: [{ key: 'asc' }, { channel: 'asc' }, { locale: 'asc' }],
  })
}

export async function upsertSystemTemplate(t: {
  key: string
  channel: NotificationChannel
  locale: string
  subject: string | null
  body: string
}): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await prismaBase.notificationTemplate.findFirst({
    where: { tenantId: null, key: t.key, channel: t.channel, locale: t.locale },
  })
  if (!existing) {
    await prismaBase.notificationTemplate.create({ data: { id: newId(), tenantId: null, ...t } })
    return 'created'
  }
  if (existing.subject === t.subject && existing.body === t.body && existing.active)
    return 'unchanged'
  await prismaBase.notificationTemplate.update({
    where: { id: existing.id },
    data: { subject: t.subject, body: t.body, active: true, deletedAt: null },
  })
  return 'updated'
}

export async function upsertTenantTemplate(
  tenantId: string,
  t: {
    key: string
    channel: NotificationChannel
    locale: string
    subject: string | null
    body: string
  },
): Promise<TemplateRow> {
  const existing = await prismaBase.notificationTemplate.findFirst({
    where: { tenantId, key: t.key, channel: t.channel, locale: t.locale },
  })
  if (existing)
    return prismaBase.notificationTemplate.update({
      where: { id: existing.id },
      data: { subject: t.subject, body: t.body, active: true, deletedAt: null },
    })
  return prismaBase.notificationTemplate.create({ data: { id: newId(), tenantId, ...t } })
}

/** Removing a tenant override = the system template applies again (soft delete). */
export async function removeTenantTemplate(
  tenantId: string,
  key: string,
  channel: NotificationChannel,
  locale: string,
  at: Date,
): Promise<boolean> {
  const r = await prismaBase.notificationTemplate.updateMany({
    where: { tenantId, key, channel, locale, deletedAt: null },
    data: { deletedAt: at, active: false },
  })
  return r.count > 0
}

// ---- rules -----------------------------------------------------------------------------------

export function listRules(tenantId: string): Promise<RuleRow[]> {
  return prisma.notificationRule.findMany({
    where: { tenantId },
    orderBy: [{ eventType: 'asc' }, { channel: 'asc' }, { recipientKind: 'asc' }],
  })
}

export function rulesForEvent(tenantId: string, eventType: string): Promise<RuleRow[]> {
  return prisma.notificationRule.findMany({ where: { tenantId, eventType } })
}

export async function upsertRule(
  tenantId: string,
  key: { eventType: string; channel: NotificationChannel; recipientKind: RecipientKind },
  data: { enabled?: boolean; config?: Prisma.InputJsonValue },
  onlyIfMissing = false,
): Promise<RuleRow> {
  const existing = await prisma.notificationRule.findFirst({ where: { tenantId, ...key } })
  if (existing) {
    if (onlyIfMissing) return existing
    return prisma.notificationRule.update({
      where: { id: existing.id, tenantId },
      data: {
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.config !== undefined ? { config: data.config } : {}),
      },
    })
  }
  return prisma.notificationRule.create({
    data: {
      id: newId(),
      tenantId,
      ...key,
      enabled: data.enabled ?? true,
      config: data.config ?? {},
    },
  })
}

export function countRules(tenantId: string): Promise<number> {
  return prisma.notificationRule.count({ where: { tenantId } })
}

// ---- notifications (delivery log + inbox) ----------------------------------------------------

export interface NotificationInput {
  id?: string
  ruleId?: string | null
  eventId?: string | null
  eventType?: string | null
  channel: NotificationChannel
  to: string
  userId?: string | null
  subject?: string | null
  body: string
  status?: NotificationStatus
  relatedType?: string | null
  relatedId?: string | null
  link?: string | null
  meta?: Prisma.InputJsonValue | null
  sentAt?: Date | null
  error?: string | null
}

export function createNotification(
  tenantId: string,
  n: NotificationInput,
): Promise<NotificationRow> {
  return prisma.notification.create({
    data: {
      id: n.id ?? newId(),
      tenantId,
      ruleId: n.ruleId ?? null,
      eventId: n.eventId ?? null,
      eventType: n.eventType ?? null,
      channel: n.channel,
      to: n.to,
      userId: n.userId ?? null,
      subject: n.subject ?? null,
      body: n.body,
      status: n.status ?? 'queued',
      relatedType: n.relatedType ?? null,
      relatedId: n.relatedId ?? null,
      link: n.link ?? null,
      meta: n.meta ?? undefined,
      sentAt: n.sentAt ?? null,
      error: n.error ?? null,
    },
  })
}

export function findNotification(tenantId: string, id: string): Promise<NotificationRow | null> {
  return prisma.notification.findFirst({ where: { tenantId, id } })
}

export function updateNotification(
  tenantId: string,
  id: string,
  data: Prisma.NotificationUpdateManyMutationInput,
) {
  return prisma.notification.updateMany({ where: { tenantId, id }, data })
}

/** Already notified for this event on this channel to this recipient (idempotent subscriber). */
export async function existsForEvent(
  tenantId: string,
  eventId: string,
  channel: NotificationChannel,
  to: string,
): Promise<boolean> {
  const r = await prisma.notification.findFirst({
    where: { tenantId, eventId, channel, to },
    select: { id: true },
  })
  return r !== null
}

export interface LogFilter {
  cursor?: string
  limit: number
  channel?: NotificationChannel
  status?: NotificationStatus
  relatedType?: string
  relatedId?: string
}

/** Keyset over (createdAt DESC, id DESC); cursor = `<createdAt ISO>|<id>`. */
export function listLog(tenantId: string, q: LogFilter): Promise<NotificationRow[]> {
  const cursor = parseCursor(q.cursor)
  return prisma.notification.findMany({
    where: {
      tenantId,
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.relatedType ? { relatedType: q.relatedType } : {}),
      ...(q.relatedId ? { relatedId: q.relatedId } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  })
}

export function cursorOf(n: { createdAt: Date; id: string }): string {
  return `${n.createdAt.toISOString()}|${n.id}`
}

function parseCursor(c: string | undefined): { createdAt: Date; id: string } | null {
  if (!c) return null
  const [iso, id] = c.split('|')
  if (!iso || !id) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : { createdAt: d, id }
}

/** In-app rows of one user, newest first. */
export function inbox(tenantId: string, userId: string, limit: number): Promise<NotificationRow[]> {
  return prisma.notification.findMany({
    where: { tenantId, userId, channel: 'in_app' },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
  })
}

export function unreadCount(tenantId: string, userId: string): Promise<number> {
  return prisma.notification.count({
    where: { tenantId, userId, channel: 'in_app', readAt: null },
  })
}

export function markRead(tenantId: string, userId: string, ids: string[] | null, at: Date) {
  return prisma.notification.updateMany({
    where: {
      tenantId,
      userId,
      channel: 'in_app',
      readAt: null,
      ...(ids ? { id: { in: ids } } : {}),
    },
    data: { readAt: at },
  })
}

/** Queued rows older than `before` (the retry sweep re-enqueues them). */
export function listStuckQueued(before: Date, limit = 200) {
  return prismaBase.notification.findMany({
    where: { status: 'queued', channel: { in: ['email', 'sms'] }, createdAt: { lt: before } },
    select: { id: true, tenantId: true },
    take: limit,
  })
}

export function countNotifications(tenantId: string) {
  return prisma.notification.count({ where: { tenantId } })
}
