import { registerSW } from 'virtual:pwa-register'

type Listener = () => void
const listeners = new Set<Listener>()
let needRefresh = false

/**
 * registerType 'prompt' (ARCHITECTURE section 4): a new build waits until the page asks for it.
 * The shell shows the "new version" toast only while the outbox is empty; `applyUpdate` then
 * tells the waiting worker to skip waiting and reloads.
 */
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    needRefresh = true
    for (const l of listeners) l()
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    setInterval(() => void registration.update().catch(() => undefined), 60 * 60_000)
  },
})

export function getNeedRefresh(): boolean {
  return needRefresh
}

export function subscribeNeedRefresh(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function applyUpdate(): void {
  void updateSW(true).then(() => window.location.reload())
}
