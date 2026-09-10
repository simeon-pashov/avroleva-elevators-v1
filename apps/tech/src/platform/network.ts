import { isNativePlatform } from './native'
import { nativeNetwork } from './native/network'

/**
 * Online state for the sync engine and the header badge. Web: navigator.onLine + the window
 * events. Native: @capacitor/network (the WebView's navigator.onLine lags behind on Android).
 */
export interface Network {
  isOnline(): boolean
  /** Calls back on every change; returns the unsubscribe. */
  subscribe(cb: () => void): () => void
}

export const webNetwork: Network = {
  isOnline() {
    return navigator.onLine
  },
  subscribe(cb) {
    window.addEventListener('online', cb)
    window.addEventListener('offline', cb)
    return () => {
      window.removeEventListener('online', cb)
      window.removeEventListener('offline', cb)
    }
  },
}

export const network: Network = isNativePlatform() ? nativeNetwork : webNetwork
