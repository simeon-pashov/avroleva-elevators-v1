import { logger } from '../../logger.js'
import type { EmailMessage, EmailSender, SmsMessage, SmsSender } from '../../ports/notifications.js'

/** Console adapters: log the message, remember it (tests assert on `sentEmails` / `sentSms`). */
export const sentEmails: EmailMessage[] = []
export const sentSms: SmsMessage[] = []

export const consoleEmailSender: EmailSender = {
  name: 'console',
  async send(msg) {
    sentEmails.push(msg)
    if (sentEmails.length > 200) sentEmails.shift()
    logger.info({ to: msg.to, subject: msg.subject }, '[email:console] would send')
    return { providerMessageId: `console-${sentEmails.length}` }
  },
}

export const consoleSmsSender: SmsSender = {
  name: 'console',
  async send(msg) {
    sentSms.push(msg)
    if (sentSms.length > 200) sentSms.shift()
    logger.info({ to: msg.to }, '[sms:console] would send')
    return { providerMessageId: `console-${sentSms.length}` }
  },
}
