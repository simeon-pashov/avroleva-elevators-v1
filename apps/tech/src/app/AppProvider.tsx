import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { MetaValues } from '../db'
import { db, getMeta, metaMap, setMeta } from '../db'
import { UPDATE_REQUIRED_EVENT } from '../platform'
import { setApiBaseOverride } from '../platform/http'
import { drain, onSync, pull, startSyncEngine } from '../sync'
import { useI18n } from '../i18n/I18nProvider'
import { hasSession } from './session'
import { applyUpdate, getNeedRefresh, subscribeNeedRefresh } from './pwa'

export interface AppState {
  /** meta loaded and runtime config (API base, locale) applied. */
  ready: boolean
  hasSession: boolean
  needsReenroll: boolean
  meta: Partial<MetaValues>
  user: MetaValues['user'] | undefined
  tenant: MetaValues['tenant'] | undefined
  online: boolean
  pulling: boolean
  pullError: string | null
  /** Outbox rows still to send (pending + sending). */
  pendingCount: number
  failedCount: number
  photosPending: number
  /** The server's X-Min-Client-Version is above this build. */
  updateRequired: boolean
  /** A new build is waiting (service worker). */
  needRefresh: boolean
  applyUpdate: () => void
  /** Re-read the token after enroll / logout. */
  refreshSession: () => void
  syncNow: () => Promise<void>
}

const AppContext = createContext<AppState | null>(null)

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
const readOnline = () => navigator.onLine

export function AppProvider({ children }: { children: ReactNode }) {
  const { suggestLocale } = useI18n()
  const [configLoaded, setConfigLoaded] = useState(false)
  const [sessionVersion, setSessionVersion] = useState(0)
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)
  const [updateRequired, setUpdateRequired] = useState(false)
  const online = useSyncExternalStore(subscribeOnline, readOnline)
  const needRefresh = useSyncExternalStore(subscribeNeedRefresh, getNeedRefresh)

  const metaRows = useLiveQuery(() => db.meta.toArray(), [])
  const pendingCount = useLiveQuery(
    () => db.outbox.where('status').anyOf('pending', 'sending').count(),
    [],
    0,
  )
  const failedCount = useLiveQuery(() => db.outbox.where('status').equals('failed').count(), [], 0)
  const photosPending = useLiveQuery(() => db.blobs.count(), [], 0)

  const meta = useMemo(() => metaMap(metaRows), [metaRows])
  const sessionPresent = useMemo(() => hasSession(), [sessionVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  const needsReenroll = meta.needsReenroll === true

  // Runtime config lives in meta: API base override and the chosen locale.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [apiBase, locale] = await Promise.all([getMeta('apiBase'), getMeta('locale')])
      if (cancelled) return
      setApiBaseOverride(apiBase ?? '')
      suggestLocale(locale)
      setConfigLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [suggestLocale])

  useEffect(() => {
    const offs = [
      onSync('pull:start', () => setPulling(true)),
      onSync('pull:done', () => {
        setPulling(false)
        setPullError(null)
      }),
      onSync('pull:error', (detail) => {
        setPulling(false)
        setPullError(typeof detail === 'string' ? detail : 'error')
      }),
    ]
    const onUpdateRequired = () => setUpdateRequired(true)
    window.addEventListener(UPDATE_REQUIRED_EVENT, onUpdateRequired)
    return () => {
      for (const off of offs) off()
      window.removeEventListener(UPDATE_REQUIRED_EVENT, onUpdateRequired)
    }
  }, [])

  const ready = configLoaded && metaRows !== undefined
  const engineActive = ready && sessionPresent && !needsReenroll

  useEffect(() => {
    if (!engineActive) return
    const stop = startSyncEngine()
    return stop
  }, [engineActive])

  // navigator.storage.persist() on first run; the result is shown in Settings.
  useEffect(() => {
    if (!engineActive || meta.storagePersisted === true) return
    if (!navigator.storage?.persist) return
    void navigator.storage
      .persist()
      .then((ok) => setMeta('storagePersisted', ok))
      .catch(() => undefined)
  }, [engineActive, meta.storagePersisted])

  const refreshSession = useCallback(() => setSessionVersion((v) => v + 1), [])
  const syncNow = useCallback(async () => {
    await pull()
    await drain()
  }, [])

  const value = useMemo<AppState>(
    () => ({
      ready,
      hasSession: sessionPresent,
      needsReenroll,
      meta,
      user: meta.user,
      tenant: meta.tenant,
      online,
      pulling,
      pullError,
      pendingCount,
      failedCount,
      photosPending,
      updateRequired,
      needRefresh,
      applyUpdate,
      refreshSession,
      syncNow,
    }),
    [
      ready,
      sessionPresent,
      needsReenroll,
      meta,
      online,
      pulling,
      pullError,
      pendingCount,
      failedCount,
      photosPending,
      updateRequired,
      needRefresh,
      refreshSession,
      syncNow,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
