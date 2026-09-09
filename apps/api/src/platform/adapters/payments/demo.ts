import { urls } from '../../urls.js'
import type { PaymentProvider } from '../../ports/PaymentProvider.js'

/**
 * Demo adapter (ADR 0001 section 6): a fake hosted page at /pay/demo/:token with a card form
 * that records a payment with source=provider, provider=demo. Only tenants with the `demoMode`
 * feature may select it (enforced by billing, not here). Nothing leaves the server.
 */
export const demoProvider: PaymentProvider = {
  name: 'demo',
  capabilities: () => ({
    enabled: true,
    hostedPage: true,
    webhooks: false,
    note: 'billing.provider.demoNote',
  }),
  async createPaymentLink(input) {
    return { url: `${urls.base()}/pay/demo/${input.token}`, provider: 'demo', providerRef: null }
  },
  async handleWebhook() {
    // The demo page settles the link directly (POST /pay/demo/:token); no webhook exists.
    return null
  },
}
