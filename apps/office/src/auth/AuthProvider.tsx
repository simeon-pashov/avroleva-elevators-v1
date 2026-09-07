import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LoginResponse, MeDto, UserRole } from '@avroleva/contracts'
import { get, patch, post, UNAUTHORIZED_EVENT } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'

export interface Auth {
  me: MeDto | null
  loading: boolean
  login: (username: string, password: string) => Promise<MeDto>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  hasRole: (...roles: UserRole[]) => boolean
  /** Persist the UI language on the user (server) and locally. */
  changeLocale: (locale: string) => Promise<void>
}

const AuthContext = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeDto | null>(null)
  const [loading, setLoading] = useState(true)
  const { setLocale, setShowBgn } = useI18n()

  const apply = useCallback(
    (m: MeDto | null) => {
      setMe(m)
      if (m) {
        setLocale(m.locale)
        setShowBgn(
          m.tenant.settings.currencyDisplay === 'EUR_BGN' || m.tenant.settings.showBgnReference,
        )
      }
    },
    [setLocale, setShowBgn],
  )

  const refresh = useCallback(async () => {
    try {
      apply(await get<MeDto>('/auth/me', { silent401: true }))
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onUnauthorized = () => setMe(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const value = useMemo<Auth>(
    () => ({
      me,
      loading,
      refresh,
      login: async (username, password) => {
        const r = await post<LoginResponse>(
          '/auth/login',
          { username, password },
          { silent401: true },
        )
        apply(r)
        return r
      },
      logout: async () => {
        try {
          await post('/auth/logout', {}, { silent401: true })
        } finally {
          setMe(null)
        }
      },
      hasRole: (...roles) => !!me && roles.includes(me.user.role),
      changeLocale: async (locale) => {
        setLocale(locale)
        if (me) {
          const updated = await patch<MeDto>('/auth/me', { locale })
          apply(updated)
        }
      },
    }),
    [me, loading, refresh, apply, setLocale],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
