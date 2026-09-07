/** Notification ports (ARCHITECTURE A1). Step 1 wires console adapters only. */
export interface EmailMessage {
  to: string
  subject: string
  text: string
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
