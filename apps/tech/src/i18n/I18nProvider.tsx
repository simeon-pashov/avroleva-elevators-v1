import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createT, formatDate, formatDateTime, localeCodes, resolveLocale } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'
import { setHttpLocale } from '../platform/http'
import { setMeta } from '../db'

const STORAGE_KEY = 'avroleva.tech.locale'

export interface I18n {
  locale: string
  locales: string[]
  t: T
  /** Explicit choice (Settings); persisted in localStorage and meta. */
  setLocale: (locale: string) => void
  /** Server-suggested locale (enroll/pull); applied only when the user has not chosen one. */
  suggestLocale: (locale: string | null | undefined) => void
  date: (d: Date | string | null | undefined) => string
  dateTime: (d: Date | string | null | undefined) => string
  /** Time of day only (HH:mm) for today's timestamps. */
  time: (d: Date | string | null | undefined) => string
  /** Picks the bg/en label of a bilingual template record. */
  pick: (v: { bg: string; en: string }) => string
}

const I18nContext = createContext<I18n | null>(null)

function readStored(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<string | undefined>(readStored)
  const [suggested, setSuggested] = useState<string | undefined>(undefined)
  const locale = resolveLocale(chosen, suggested, navigator.language?.split('-')[0])

  useEffect(() => {
    document.documentElement.lang = locale
    setHttpLocale(locale)
  }, [locale])

  const setLocale = useCallback((next: string) => {
    const loc = resolveLocale(next)
    setChosen(loc)
    try {
      localStorage.setItem(STORAGE_KEY, loc)
    } catch {
      /* private mode */
    }
    void setMeta('locale', loc).catch(() => undefined)
  }, [])

  const suggestLocale = useCallback((next: string | null | undefined) => {
    if (next) setSuggested(resolveLocale(next))
  }, [])

  const value = useMemo<I18n>(() => {
    const t = createT(locale)
    return {
      locale,
      locales: localeCodes,
      t,
      setLocale,
      suggestLocale,
      date: (d) => formatDate(d, locale),
      dateTime: (d) => formatDateTime(d, locale),
      time: (d) =>
        d
          ? new Intl.DateTimeFormat(locale, {
              timeStyle: 'short',
              timeZone: 'Europe/Sofia',
            }).format(typeof d === 'string' ? new Date(d) : d)
          : '',
      pick: (v) => (locale === 'en' ? v.en : v.bg) || v.bg,
    }
  }, [locale, setLocale, suggestLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n outside I18nProvider')
  return ctx
}

export function useT(): T {
  return useI18n().t
}
