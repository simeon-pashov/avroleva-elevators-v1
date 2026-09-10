import type * as PreferencesModule from '@capacitor/preferences'
import type { SecureStorage } from '../secureStorage'

/**
 * @capacitor/preferences (SharedPreferences on Android) behind a memory cache. The plugin API is
 * asynchronous; the app reads the token on every request, so `init()` loads every stored key
 * once at start and later writes go to the cache first and to the plugin in the background.
 */
const cache = new Map<string, string>()
const PREFIX = 'avroleva.tech.'

// Never let a promise settle with the plugin object: a Capacitor plugin proxy answers every
// property, `then` included, so promise assimilation calls `Preferences.then()` -> "not
// implemented on android" and nothing ever resolves. Always await the module namespace and read
// `.Preferences` synchronously afterwards (an `async` function returning the plugin has the same
// problem).
let mod: Promise<typeof PreferencesModule> | undefined
function preferences(): Promise<typeof PreferencesModule> {
  mod ??= import('@capacitor/preferences')
  return mod
}

export const nativeSecureStorage: SecureStorage = {
  get(key) {
    return cache.get(key) ?? null
  },
  set(key, value) {
    cache.set(key, value)
    void preferences()
      .then((m) => m.Preferences.set({ key: PREFIX + key, value }))
      .catch(() => undefined)
  },
  remove(key) {
    cache.delete(key)
    void preferences()
      .then((m) => m.Preferences.remove({ key: PREFIX + key }))
      .catch(() => undefined)
  },
  async init() {
    try {
      const p = (await preferences()).Preferences
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
