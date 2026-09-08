import { config } from '../config.js'
import type { Geocoder } from '../ports/geocoder.js'
import type { EmailSender, SmsSender } from '../ports/notifications.js'
import type { FileStorage } from '../ports/storage.js'
import { createNominatimGeocoder } from './geocoder/nominatim.js'
import { createStubGeocoder } from './geocoder/stub.js'
import { consoleEmailSender, consoleSmsSender } from './notifications/console.js'
import { createLocalStorage } from './storage/local.js'

/** Adapter selection by env (ARCHITECTURE A1). Tests may override `adapters.geocoder`. */
export const adapters: {
  geocoder: Geocoder
  email: EmailSender
  sms: SmsSender
  storage: FileStorage
} = {
  geocoder:
    config.GEOCODER === 'stub' || config.NODE_ENV === 'test'
      ? createStubGeocoder()
      : createNominatimGeocoder(config.NOMINATIM_URL),
  email: consoleEmailSender,
  sms: consoleSmsSender,
  storage: createLocalStorage(config.DATA_DIR),
}
