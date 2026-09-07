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

export const defectCatalog: DefectCatalog = load('../defects/art10.v1.json')
export const calendarRules: CalendarRules = load('../calendar-rules.json')

export function defectCatalogItem(code: string | null | undefined): DefectCatalogItem | undefined {
  if (!code) return undefined
  return defectCatalog.items.find((i) => i.code === code)
}

export function defectLabel(code: string, locale: string): string {
  const item = defectCatalogItem(code)
  if (!item) return code
  return locale === 'en' ? item.en : item.bg
}
