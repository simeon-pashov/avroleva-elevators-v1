/**
 * Reference data seeded, not coded (ARCHITECTURE A6). The JSON files live at the package root so
 * a non-developer can edit them; this module loads and types them. Tenant overrides live in
 * `tenant.settings` and win over these defaults.
 */
import { readFileSync } from 'node:fs'

function load<T>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as T
}

export interface DefectCatalogItem {
  /** "1".."17" or "other" */
  code: string
  bg: string
  en: string
  /** Every catalogue item requires the lift to be taken out of service; "other" does not by default. */
  stopLift: boolean
  /** Item number as printed on the notice ("т. 7"); null for the free-text item. */
  ref: string | null
}

export interface DefectCatalog {
  key: string
  version: number
  items: DefectCatalogItem[]
}

export interface CalendarRules {
  version: number
  inspection: {
    periodicIntervalMonths: number
    firstIntervalMonths: number
    alertDaysBefore: number[]
  }
  defectFollowUpDays: number
  callbackSlaMinutes: number
  alarmTestIntervalMonths: number | null
}

export interface ChecklistAppliesToData {
  driveType?: Array<'electric' | 'hydraulic' | 'mrl'>
  doorType?: Array<'manual' | 'semi_auto' | 'auto'>
  goodsOnly?: boolean
}

export interface ChecklistItemData {
  code: string
  group: string
  bg: string
  en: string
  appliesTo: ChecklistAppliesToData
  resultType: 'ok_defect_na'
}

export interface ChecklistTemplateData {
  key: string
  version: number
  name: { bg: string; en: string }
  /** Item number of the ordinance appendix, for the office only (never shown to a technician). */
  ref: string
  groups: Array<{ code: string; bg: string; en: string }>
  items: ChecklistItemData[]
}

export const defectCatalog: DefectCatalog = load('../defects/art10.v1.json')
export const calendarRules: CalendarRules = load('../calendar-rules.json')
/** System checklist templates, seeded as `checklist_template` rows with tenantId NULL. */
export const checklistTemplates: ChecklistTemplateData[] = [
  load('../checklists/functional-check.v1.json'),
]

export function defectCatalogItem(code: string | null | undefined): DefectCatalogItem | undefined {
  if (!code) return undefined
  return defectCatalog.items.find((i) => i.code === code)
}

export function defectLabel(code: string, locale: string): string {
  const item = defectCatalogItem(code)
  if (!item) return code
  return locale === 'en' ? item.en : item.bg
}

// ---- Notification templates (ARCHITECTURE A5: templates as data) ---------------------------

export type NotificationTemplateChannel = 'email' | 'sms' | 'in_app' | 'viber_link'

export interface NotificationTemplateText {
  subject?: string
  body: string
}

export interface NotificationTemplatesData {
  version: number
  /** key -> channel -> locale -> text (Handlebars). */
  templates: Record<
    string,
    Partial<Record<NotificationTemplateChannel, Record<string, NotificationTemplateText>>>
  >
}

export const notificationTemplates: NotificationTemplatesData = load(
  '../notifications/templates.v1.json',
)

/** Flat list for seeding `notification_template` system rows. */
export function listNotificationTemplates(): Array<{
  key: string
  channel: NotificationTemplateChannel
  locale: string
  subject: string | null
  body: string
}> {
  const out: Array<{
    key: string
    channel: NotificationTemplateChannel
    locale: string
    subject: string | null
    body: string
  }> = []
  for (const [key, channels] of Object.entries(notificationTemplates.templates)) {
    for (const [channel, locales] of Object.entries(channels)) {
      if (!locales) continue
      for (const [locale, text] of Object.entries(locales)) {
        out.push({
          key,
          channel: channel as NotificationTemplateChannel,
          locale,
          subject: text.subject ?? null,
          body: text.body,
        })
      }
    }
  }
  return out
}
