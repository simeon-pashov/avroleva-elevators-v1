import type { SmsSender } from '../../ports/notifications.js'

/**
 * Generic HTTP SMS gateway (no vendor lock): POST `{to, text}` as JSON to SMS_HTTP_URL with
 * `Authorization: Bearer SMS_HTTP_TOKEN`. A 2xx answer is a send; `{id}` / `{messageId}` in the
 * JSON body, when present, becomes the provider id. A Bulgarian aggregator or Twilio is one thin
 * adapter next to this one.
 */
export function createHttpSmsSender(url: string, token?: string): SmsSender {
  return {
    name: 'http',
    async send(msg) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ to: msg.to, text: msg.text }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`sms gateway ${res.status}: ${(await res.text()).slice(0, 200)}`)
      let id: string | undefined
      try {
        const body = (await res.json()) as { id?: string; messageId?: string }
        id = body.id ?? body.messageId
      } catch {
        /* non-JSON answer is fine */
      }
      return { providerMessageId: id }
    },
  }
}
