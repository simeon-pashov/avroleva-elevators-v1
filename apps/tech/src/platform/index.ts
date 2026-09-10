import type { AppHost } from './appHost'
import { appHost } from './appHost'
import type { Camera } from './camera'
import { webCamera } from './camera'
import type { Geolocation } from './geolocation'
import { webGeolocation } from './geolocation'
import type { HttpClient } from './http'
import { webHttp } from './http'
import { isNativePlatform, platformName } from './native'
import { nativeCamera } from './native/camera'
import { nativeGeolocation } from './native/geolocation'
import { nativeShare } from './native/share'
import type { Network } from './network'
import { network } from './network'
import type { SecureStorage } from './secureStorage'
import { secureStorage } from './secureStorage'
import type { Share } from './share'
import { webShare } from './share'

/**
 * The platform seams of ARCHITECTURE section 4: camera, geolocation, http, secureStorage, share
 * (plus network and the app host added with the Capacitor wrap). Web implementations are the
 * default; inside the Capacitor shell (`isNativePlatform()`) the native ones map 1:1 to
 * @capacitor/camera | geolocation | preferences | share | network | app. http stays fetch with an
 * absolute API base in both cases.
 */
export interface Platform {
  camera: Camera
  geolocation: Geolocation
  http: HttpClient
  secureStorage: SecureStorage
  share: Share
  network: Network
  appHost: AppHost
  /** 'web' | 'android' | 'ios' */
  name: string
  isNative: boolean
}

const native = isNativePlatform()

export const platform: Platform = {
  camera: native ? nativeCamera : webCamera,
  geolocation: native ? nativeGeolocation : webGeolocation,
  http: webHttp,
  secureStorage,
  share: native ? nativeShare : webShare,
  network,
  appHost,
  name: platformName(),
  isNative: native,
}

/** Resolves when the persisted secrets are readable (native Preferences are asynchronous). */
export const platformReady: Promise<void> = secureStorage.init()

export type { AppHost, Camera, Geolocation, HttpClient, Network, SecureStorage, Share }
export { ApiError, NetworkError, UNAUTHORIZED_EVENT, UPDATE_REQUIRED_EVENT } from './http'
export { API_BASE_KEY, SESSION_TOKEN_KEY } from './secureStorage'
export { isNativePlatform } from './native'
