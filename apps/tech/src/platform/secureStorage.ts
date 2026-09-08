/**
 * Small key/value store for secrets (the device session token). Web: localStorage; a Capacitor
 * wrap maps this 1:1 to @capacitor/preferences (or a keychain plugin).
 */
export interface SecureStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
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
}

export const SESSION_TOKEN_KEY = 'sessionToken'
