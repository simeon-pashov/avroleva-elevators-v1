import type { Network } from '../network'

let online = navigator.onLine
const listeners = new Set<() => void>()
let started = false

function notify() {
  for (const l of listeners) l()
}

/** Starts the plugin listener once; until it answers, navigator.onLine is the best guess. */
function start() {
  if (started) return
  started = true
  void import('@capacitor/network')
    .then(async ({ Network: plugin }) => {
      const status = await plugin.getStatus()
      if (status.connected !== online) {
        online = status.connected
        notify()
      }
      await plugin.addListener('networkStatusChange', (s) => {
        if (s.connected === online) return
        online = s.connected
        notify()
      })
    })
    .catch(() => {
      // Plugin unavailable: fall back to the window events.
      window.addEventListener('online', () => {
        online = true
        notify()
      })
      window.addEventListener('offline', () => {
        online = false
        notify()
      })
    })
}

export const nativeNetwork: Network = {
  isOnline() {
    start()
    return online
  },
  subscribe(cb) {
    start()
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  },
}
