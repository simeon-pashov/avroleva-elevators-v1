import { config } from '../config.js'
import type { Geocoder } from '../ports/geocoder.js'
import type { EmailSender, SmsSender, ViberLinker } from '../ports/notifications.js'
import type { FileStorage } from '../ports/storage.js'
import { createNominatimGeocoder } from './geocoder/nominatim.js'
import { createStubGeocoder } from './geocoder/stub.js'
import { consoleEmailSender, consoleSmsSender } from './notifications/console.js'
import { createSmtpEmailSender } from './notifications/smtp.js'
import { createHttpSmsSender } from './notifications/smsHttp.js'
import { viberLinker } from './notifications/viberLink.js'
import { createLocalStorage } from './storage/local.js'

function pickEmail(): EmailSender {
  if (config.EMAIL_PROVIDER === 'smtp' && config.SMTP_URL && config.NODE_ENV !== 'test')
    return createSmtpEmailSender(config.SMTP_URL, config.EMAIL_FROM)
  return consoleEmailSender
}

function pickSms(): SmsSender {
  if (config.SMS_PROVIDER === 'http' && config.SMS_HTTP_URL && config.NODE_ENV !== 'test')
    return createHttpSmsSender(config.SMS_HTTP_URL, config.SMS_HTTP_TOKEN)
  return consoleSmsSender
}

/** Adapter selection by env (ARCHITECTURE A1). Tests may override any entry. */
export const adapters: {
  geocoder: Geocoder
  email: EmailSender
  sms: SmsSender
  viber: ViberLinker
  storage: FileStorage
} = {
  geocoder:
    config.GEOCODER === 'stub' || config.NODE_ENV === 'test'
      ? createStubGeocoder()
      : createNominatimGeocoder(config.NOMINATIM_URL),
  email: pickEmail(),
  sms: pickSms(),
  viber: viberLinker,
  storage: createLocalStorage(config.DATA_DIR),
}
