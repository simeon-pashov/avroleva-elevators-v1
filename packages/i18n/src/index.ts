import { locales, sourceLocale } from './locales/index.js'
import { formatMessage } from './format.js'
import type { Params } from './format.js'

export type { Messages } from './locales/index.js'
export type { Params } from './format.js'
export { locales, sourceLocale, formatMessage }

export const DEFAULT_LOCALE = sourceLocale
export const localeCodes: string[] = Object.keys(locales)

export function isLocale(code: unknown): code is string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(locales, code)
}

/** Resolution order (ARCHITECTURE, i18n): user.locale -> tenant.locale -> 'bg'. */
export function resolveLocale(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) if (isLocale(c)) return c
  return DEFAULT_LOCALE
}

export type T = (key: string, params?: Params) => string

/** Translate one key. Falls back to the source locale, then to the key itself. */
export function translate(locale: string, key: string, params?: Params): string {
  const msg = locales[locale]?.[key] ?? locales[sourceLocale]?.[key]
  if (msg === undefined) return key
  return formatMessage(msg, params, locale)
}

export function createT(locale: string): T {
  const loc = resolveLocale(locale)
  return (key, params) => translate(loc, key, params)
}

/** True when the key exists in the given (or source) locale - useful for optional labels. */
export function hasKey(key: string, locale: string = sourceLocale): boolean {
  return locales[locale]?.[key] !== undefined || locales[sourceLocale]?.[key] !== undefined
}

// ---- Intl helpers -----------------------------------------------------------------------

export const TIMEZONE = 'Europe/Sofia'
export const BGN_PER_EUR = 1.95583

export function formatDate(d: Date | string | null | undefined, locale: string): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: TIMEZONE }).format(date)
}

export function formatDateTime(d: Date | string | null | undefined, locale: string): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: TIMEZONE,
  }).format(date)
}

export function formatNumber(n: number, locale: string, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, opts).format(n)
}

/** Money is stored as integer cents (ARCHITECTURE section 3). */
export function formatMoney(cents: number, locale: string, currency = 'EUR'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}

/** Optional BGN reference (fixed rate 1.95583) shown next to EUR when the tenant asks for it. */
export function formatBgnReference(eurCents: number, locale: string): string {
  return formatMoney(Math.round(eurCents * BGN_PER_EUR), locale, 'BGN')
}
