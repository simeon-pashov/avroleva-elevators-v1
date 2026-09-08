import { drain } from './outbox'
import { pull } from './pull'
import { loadClockOffset } from './state'

const PULL_INTERVAL_MS = 15 * 60_000
const FOCUS_PULL_THROTTLE_MS = 60_000

let stop: (() => void) | null = null
let lastFocusPull = 0

/**
 * Pull on start, on `online`, on becoming visible/focused (throttled), every 15 min while open,
 * and after a successful push drain (outbox.ts). Drain on start, on `online` and when the service
 * worker's Background Sync event posts `{type:'drain'}`. Idempotent: one engine per page.
 */
export function startSyncEngine(): () => void {
  if (stop) return stop
  const onOnline = () => {
    void pull()
    void drain()
  }
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastFocusPull < FOCUS_PULL_THROTTLE_MS) return
    lastFocusPull = Date.now()
    void pull()
    void drain()
  }
  const onMessage = (e: MessageEvent) => {
    if ((e.data as { type?: string } | undefined)?.type === 'drain') void drain()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  navigator.serviceWorker?.addEventListener('message', onMessage)
  const interval = setInterval(() => void pull(), PULL_INTERVAL_MS)
  lastFocusPull = Date.now()
  void loadClockOffset().then(() => {
    void pull()
    void drain()
  })
  stop = () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
    navigator.serviceWorker?.removeEventListener('message', onMessage)
    clearInterval(interval)
    stop = null
  }
  return stop
}
