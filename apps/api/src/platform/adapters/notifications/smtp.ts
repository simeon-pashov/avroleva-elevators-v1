import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { EmailSender } from '../../ports/notifications.js'

/** nodemailer over SMTP_URL (`smtp://user:pass@host:587`, `smtps://…`); any provider. */
export function createSmtpEmailSender(smtpUrl: string, from: string): EmailSender {
  let transporter: Transporter | null = null
  const get = () => (transporter ??= nodemailer.createTransport(smtpUrl))
  return {
    name: 'smtp',
    async send(msg) {
      const info = await get().sendMail({
        from: msg.fromName ? { name: msg.fromName, address: from } : from,
        to: msg.to,
        replyTo: msg.replyTo,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      })
      return { providerMessageId: info.messageId }
    },
  }
}
