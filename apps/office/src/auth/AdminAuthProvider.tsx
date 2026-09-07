import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AdminMeDto } from '@avroleva/contracts'
import { BASE, get, post } from '../lib/api'

export interface AdminAuth {
  admin: AdminMeDto['admin'] | null
  loading: boolean
  /** Runs the session probe if it has not run yet (the admin area calls it on mount). */
  ensure: () => void
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AdminAuth | null>(null)

/** The admin cookie only matters under /admin; tenant pages skip the probe (no 401 noise). */
export const isAdminPath = () => window.location.pathname.startsWith(`${BASE}/admin`)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminMeDto['admin'] | null>(null)
  const [loading, setLoading] = useState(true)
  const probed = useRef(false)

  const refresh = useCallback(async () => {
    probed.current = true
    try {
      setAdmin((await get<AdminMeDto>('/admin/auth/me', { silent401: true })).admin)
    } catch {
      setAdmin(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Probe at most once; children (RequireAdmin) may trigger it before this effect runs.
  const ensure = useCallback(() => {
    if (probed.current) return
    setLoading(true)
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (isAdminPath()) ensure()
    else if (!probed.current) setLoading(false)
  }, [ensure])

  const value = useMemo<AdminAuth>(
    () => ({
      admin,
      loading,
      ensure,
      login: async (username, password) => {
        const r = await post<AdminMeDto>(
          '/admin/auth/login',
          { username, password },
          { silent401: true },
        )
        probed.current = true
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
    [admin, loading, ensure],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminAuth(): AdminAuth {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdminAuth outside AdminAuthProvider')
  return ctx
}
