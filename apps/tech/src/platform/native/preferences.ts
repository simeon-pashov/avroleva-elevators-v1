import type { PreferencesPlugin } from '@capacitor/preferences'
import type { SecureStorage } from '../secureStorage'

/**
 * @capacitor/preferences (SharedPreferences on Android) behind a memory cache. The plugin API is
 * asynchronous; the app reads the token on every request, so `init()` loads every stored key
 * once at start and later writes go to the cache first and to the plugin in the background.
 */
const cache = new Map<string, string>()
const PREFIX = 'avroleva.tech.'

let mod: Promise<PreferencesPlugin> | undefined
function preferences(): Promise<PreferencesPlugin> {
  mod ??= import('@capacitor/preferences').then((m) => m.Preferences)
  return mod
}

export const nativeSecureStorage: SecureStorage = {
  get(key) {
    return cache.get(key) ?? null
  },
  set(key, value) {
    cache.set(key, value)
    void preferences()
      .then((p) => p.set({ key: PREFIX + key, value }))
      .catch(() => undefined)
  },
  remove(key) {
    cache.delete(key)
    void preferences()
      .then((p) => p.remove({ key: PREFIX + key }))
      .catch(() => undefined)
  },
  async init() {
    try {
      const p = await preferences()
      const { keys } = await p.keys()
      for (const full of keys) {
        if (!full.startsWith(PREFIX)) continue
        const { value } = await p.get({ key: full })
        if (value !== null) cache.set(full.slice(PREFIX.length), value)
      }
    } catch {
      /* the plugin is missing (web build) or storage is unavailable: start empty */
    }
  },
}
