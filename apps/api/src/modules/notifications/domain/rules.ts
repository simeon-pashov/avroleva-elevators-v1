import type {
  NotificationChannel,
  NotificationRuleConfig,
  NotifiableEventType,
  RecipientKind,
} from '@avroleva/contracts'
import { RULE_MATRIX, TEMPLATE_KEY_BY_EVENT, notificationRuleConfig } from '@avroleva/contracts'

/**
 * Rule matching (pure). A rule = (eventType, channel, recipientKind, enabled, config); the
 * notifications subscriber asks "which enabled rules apply to this event?" and, for
 * InspectionDueSoon, whether the alert step is one the rule wants.
 */
export interface RuleLike {
  id: string
  eventType: string
  channel: NotificationChannel
  recipientKind: RecipientKind
  enabled: boolean
  config: unknown
}

export function parseRuleConfig(raw: unknown): NotificationRuleConfig {
  const r = notificationRuleConfig.safeParse(raw ?? {})
  return r.success ? r.data : {}
}

export function matchRules<R extends RuleLike>(
  rules: R[],
  eventType: string,
  payload: Record<string, unknown> = {},
): R[] {
  return rules.filter((r) => {
    if (!r.enabled || r.eventType !== eventType) return false
    if (eventType === 'InspectionDueSoon') {
      const cfg = parseRuleConfig(r.config)
      const inDays = typeof payload.inDays === 'number' ? payload.inDays : null
      if (cfg.days && cfg.days.length > 0 && inDays !== null && !cfg.days.includes(inDays))
        return false
    }
    return true
  })
}

export function templateKeyFor(eventType: string): string {
  return TEMPLATE_KEY_BY_EVENT[eventType as NotifiableEventType] ?? eventType
}

/** Default rule set of a new tenant (MVP-PLAN phase 7: everything useful ON). */
export function defaultRules(): Array<{
  eventType: NotifiableEventType
  channel: NotificationChannel
  recipientKind: RecipientKind
  enabled: boolean
  config: NotificationRuleConfig
}> {
  return RULE_MATRIX.map((m) => {
    const isBuildingEmail = m.channel === 'email' && m.recipientKind === 'building_contact'
    // SMS needs a paid gateway: those rules exist but start OFF until one is configured.
    const on = m.channel !== 'sms'
    const config: NotificationRuleConfig = {}
    if (isBuildingEmail) config.fallbackViberLink = true
    if (m.eventType === 'InspectionDueSoon') config.days = m.channel === 'email' ? [30] : [30, 7]
    return { ...m, enabled: on, config }
  })
}

/** Recipients of "office" kind = owner + office users; "owner" = owners only. */
export function officeRoles(kind: RecipientKind): ReadonlyArray<'owner' | 'office'> {
  return kind === 'owner' ? ['owner'] : ['owner', 'office']
}

/** Sample data for the template preview (every key the shipped templates use). */
export function sampleData(locale: string): Record<string, unknown> {
  const bg = locale !== 'en'
  return {
    now: new Date().toISOString(),
    tenant: {
      name: bg ? 'Демо Лифт Сервиз' : 'Demo Lift Service',
      phone: '02 987 6543',
      emergencyPhone: '0700 12 345',
      email: 'office@demo-lift.bg',
      address: bg ? 'София, ул. Примерна 1' : 'Sofia, 1 Primerna St',
    },
    building: {
      addressText: bg ? 'София, ж.к. Младост 1, бл. 25, вх. А' : 'Sofia, Mladost 1, bl. 25, ent. A',
      customerName: bg ? 'ЕС „Младост 1, бл. 25“' : 'Owners association "Mladost 1, bl. 25"',
    },
    elevator: { internalNo: bg ? 'вх. А' : 'ent. A', regNo: 'СФ-1234' },
    contact: {
      name: bg ? 'Петя Димова' : 'Petya Dimova',
      phone: '+359 888 123 456',
      email: 'petya@example.com',
    },
    user: { name: bg ? 'Мария Георгиева' : 'Maria Georgieva' },
    visit: {
      date: new Date().toISOString(),
      kindLabel: bg ? 'функционална проверка' : 'functional check',
      technicians: bg ? 'Иван Петров, Георги Илиев' : 'Ivan Petrov, Georgi Iliev',
      summary: { ok: 20, defect: 1, na: 2 },
      defects: bg ? 'Шум в редуктора' : 'Noise in the gearbox',
      notes: '',
      flags: '',
    },
    callback: {
      receivedAt: new Date(Date.now() - 50 * 60_000).toISOString(),
      classificationLabel: bg ? 'блокирани хора' : 'trapped persons',
      description: bg ? 'Кабината спря между 3 и 4 етаж' : 'Cabin stopped between floors 3 and 4',
      trappedCount: 1,
      responseMinutes: 25,
      elapsedMinutes: 50,
      slaMinutes: 60,
      cause: bg ? 'Изгорял контактор' : 'Burnt contactor',
      actionTaken: bg ? 'Подменен контактор' : 'Contactor replaced',
    },
    invoice: {
      number: 1042,
      period: '2026-08',
      totalCents: 24000,
      dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    },
    inspection: {
      dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      inDays: 30,
    },
    defect: {
      description: bg ? 'Износени канали на триещата шайба' : 'Worn sheave grooves',
      recordedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      followUpDueAt: new Date().toISOString().slice(0, 10),
    },
    check: {
      dueAt: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
      overdueDays: 3,
    },
    report: {
      periodLabel: bg ? 'август 2026' : 'August 2026',
      visits: 2,
      callbacks: 1,
      avgResponseMinutes: 25,
      openDefects: 1,
    },
    export: { sizeLabel: '12,4 MB', url: 'https://example.com/files/export/…' },
    deletion: { at: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    link: 'https://example.com/',
    // Step 9: the building's statement page behind its magic link.
    statementLink: {
      url: 'https://example.com/s/0123456789abcdef0123456789abcdef',
      expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      message: '',
    },
  }
}
