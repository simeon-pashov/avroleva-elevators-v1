import type { Camera } from './camera'
import { webCamera } from './camera'
import type { Geolocation } from './geolocation'
import { webGeolocation } from './geolocation'
import type { HttpClient } from './http'
import { webHttp } from './http'
import type { SecureStorage } from './secureStorage'
import { webSecureStorage } from './secureStorage'
import type { Share } from './share'
import { webShare } from './share'

/**
 * The five platform seams of ARCHITECTURE section 4. A Capacitor wrap swaps the implementations
 * here (camera -> @capacitor/camera, geolocation -> @capacitor/geolocation, secureStorage ->
 * @capacitor/preferences, share -> @capacitor/share; http stays fetch with an absolute API base).
 */
export interface Platform {
  camera: Camera
  geolocation: Geolocation
  http: HttpClient
  secureStorage: SecureStorage
  share: Share
}

export const platform: Platform = {
  camera: webCamera,
  geolocation: webGeolocation,
  http: webHttp,
  secureStorage: webSecureStorage,
  share: webShare,
}

export type { Camera, Geolocation, HttpClient, SecureStorage, Share }
export { ApiError, NetworkError, UNAUTHORIZED_EVENT, UPDATE_REQUIRED_EVENT } from './http'
export { SESSION_TOKEN_KEY } from './secureStorage'
