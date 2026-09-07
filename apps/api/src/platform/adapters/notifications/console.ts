import { logger } from '../../logger.js'
import type { EmailSender, SmsSender } from '../../ports/notifications.js'

export const consoleEmailSender: EmailSender = {
  name: 'console',
  async send(msg) {
    logger.info({ to: msg.to, subject: msg.subject }, '[email:console] would send')
    return {}
  },
}

export const consoleSmsSender: SmsSender = {
  name: 'console',
  async send(msg) {
    logger.info({ to: msg.to }, '[sms:console] would send')
    return {}
  },
}
