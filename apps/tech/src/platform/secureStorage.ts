import { isNativePlatform } from './native'
import { nativeSecureStorage } from './native/preferences'

/**
 * Small key/value store for secrets and runtime config (the device session token, the server
 * address). Web: localStorage. Native: @capacitor/preferences behind a write-through memory
 * cache, so reads stay synchronous - `init()` fills the cache once before the app renders.
 */
export interface SecureStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  /** Native only: loads the persisted values into the cache. Resolves at once on the web. */
  init(): Promise<void>
}

const PREFIX = 'avroleva.tech.'

export const webSecureStorage: SecureStorage = {
  get(key) {
    try {
      return localStorage.getItem(PREFIX + key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value)
    } catch {
      /* private mode / quota */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key)
    } catch {
      /* ignore */
    }
  },
  init() {
    return Promise.resolve()
  },
}

export const SESSION_TOKEN_KEY = 'sessionToken'
/** Server address chosen on the Enroll screen / in Settings (empty = the build-time default). */
export const API_BASE_KEY = 'apiBase'

export const secureStorage: SecureStorage = isNativePlatform()
  ? nativeSecureStorage
  : webSecureStorage
