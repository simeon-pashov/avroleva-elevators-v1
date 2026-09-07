import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  createT,
  formatBgnReference,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  localeCodes,
  resolveLocale,
} from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'

const STORAGE_KEY = 'avroleva.locale'

export interface I18n {
  locale: string
  locales: string[]
  t: T
  setLocale: (locale: string) => void
  /** Currency display preference from the tenant settings; the shell sets it after login. */
  showBgn: boolean
  setShowBgn: (v: boolean) => void
  date: (d: Date | string | null | undefined) => string
  dateTime: (d: Date | string | null | undefined) => string
  number: (n: number, opts?: Intl.NumberFormatOptions) => string
  money: (cents: number) => string
  /** Money with the optional BGN reference in brackets. */
  moneyFull: (cents: number) => string
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
  const [locale, setLocaleState] = useState<string>(() =>
    resolveLocale(readStored(), navigator.language?.split('-')[0]),
  )
  const [showBgn, setShowBgn] = useState(false)

  const setLocale = useCallback((next: string) => {
    const loc = resolveLocale(next)
    setLocaleState(loc)
    try {
      localStorage.setItem(STORAGE_KEY, loc)
    } catch {
      /* private mode */
    }
    document.documentElement.lang = loc
  }, [])

  const value = useMemo<I18n>(() => {
    const t = createT(locale)
    return {
      locale,
      locales: localeCodes,
      t,
      setLocale,
      showBgn,
      setShowBgn,
      date: (d) => formatDate(d, locale),
      dateTime: (d) => formatDateTime(d, locale),
      number: (n, opts) => formatNumber(n, locale, opts),
      money: (cents) => formatMoney(cents, locale),
      moneyFull: (cents) =>
        showBgn
          ? `${formatMoney(cents, locale)} (${formatBgnReference(cents, locale)})`
          : formatMoney(cents, locale),
    }
  }, [locale, setLocale, showBgn])

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
