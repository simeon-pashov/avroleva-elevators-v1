import { createT, isLocale, resolveLocale } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'

export { createT, resolveLocale }
export type { T }

/** Picks the first registered locale from an Accept-Language header, else undefined. */
export function localeFromAcceptLanguage(header: string | undefined): string | undefined {
  if (!header) return undefined
  for (const part of header.split(',')) {
    const code = part.split(';')[0]?.trim().toLowerCase().split('-')[0]
    if (isLocale(code)) return code
  }
  return undefined
}
