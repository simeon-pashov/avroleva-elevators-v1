import type { PaymentProvider } from '../../ports/PaymentProvider.js'

/**
 * IRIS (Bulgarian open-banking "pay by link") - STUB. The wiring exists (config keys, provider
 * selection, webhook route /webhooks/payments/iris) so that a real integration is a change to
 * this file only. Until then `capabilities().enabled` is false and nothing is called.
 *
 * TODO(iris): createPaymentLink -> POST /v1/payment-links with amount, IBAN of the beneficiary,
 * remittance = our reference, return_url; handleWebhook -> verify HMAC of the raw body with
 * IRIS_WEBHOOK_SECRET, map "payment.completed" to {kind:'paid', token from metadata}.
 */
export function createIrisProvider(cfg: {
  apiKey?: string
  webhookSecret?: string
}): PaymentProvider {
  return {
    name: 'iris',
    capabilities: () => ({
      enabled: false,
      hostedPage: true,
      webhooks: true,
      note: cfg.apiKey ? 'billing.provider.notIntegrated' : 'billing.provider.missingKeys',
    }),
    async createPaymentLink() {
      throw new Error('iris payment provider is not integrated yet')
    },
    async handleWebhook() {
      return null
    },
  }
}
