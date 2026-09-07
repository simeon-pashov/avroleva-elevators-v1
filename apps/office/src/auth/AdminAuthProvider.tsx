import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AdminMeDto } from '@avroleva/contracts'
import { get, post } from '../lib/api'

export interface AdminAuth {
  admin: AdminMeDto['admin'] | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AdminAuth | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminMeDto['admin'] | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setAdmin((await get<AdminMeDto>('/admin/auth/me', { silent401: true })).admin)
    } catch {
      setAdmin(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AdminAuth>(
    () => ({
      admin,
      loading,
      login: async (username, password) => {
        const r = await post<AdminMeDto>(
          '/admin/auth/login',
          { username, password },
          { silent401: true },
        )
        setAdmin(r.admin)
      },
      logout: async () => {
        try {
          await post('/admin/auth/logout', {}, { silent401: true })
        } finally {
          setAdmin(null)
        }
      },
    }),
    [admin, loading],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminAuth(): AdminAuth {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdminAuth outside AdminAuthProvider')
  return ctx
}
