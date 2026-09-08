/**
 * Notification ports (ARCHITECTURE A1). Adapters in platform/adapters/notifications, chosen by
 * env: EMAIL_PROVIDER=console|smtp, SMS_PROVIDER=console|http. Viber is deep-link only in the
 * MVP (the office user taps a link and sends the text by hand); a Viber Business adapter would
 * implement the same `ViberLinker` shape plus a real send.
 */
export interface EmailAttachment {
  filename: string
  content: Buffer | string
  contentType: string
}

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
  /** Display name for the From header (the tenant's name); the address comes from EMAIL_FROM. */
  fromName?: string
  replyTo?: string
  attachments?: EmailAttachment[]
}
export interface EmailSender {
  readonly name: string
  send(msg: EmailMessage): Promise<{ providerMessageId?: string }>
}

export interface SmsMessage {
  to: string
  text: string
}
export interface SmsSender {
  readonly name: string
  send(msg: SmsMessage): Promise<{ providerMessageId?: string }>
}

export interface ViberLink {
  number: string
  chatUrl: string
  forwardUrl: string
  webUrl: string
  text: string
}
/** Deep-link mode: produces the links; nothing is sent by the server. */
export interface ViberLinker {
  readonly name: string
  build(phone: string, text: string): ViberLink
}
