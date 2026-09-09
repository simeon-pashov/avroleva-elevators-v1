import type { PaymentProvider } from '../../ports/PaymentProvider.js'

/** Default: no hosted payments; documents show bank details + the EPC QR only. */
export const noneProvider: PaymentProvider = {
  name: 'none',
  capabilities: () => ({ enabled: false, hostedPage: false, webhooks: false, note: null }),
  async createPaymentLink() {
    throw new Error('payment provider "none" cannot create links')
  },
  async handleWebhook() {
    return null
  },
}
