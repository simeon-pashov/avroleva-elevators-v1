import type { PaymentProvider } from '../../ports/PaymentProvider.js'

/**
 * Stripe Checkout - STUB. The wiring exists (config keys, provider selection, webhook route
 * /webhooks/payments/stripe) so that a real integration is a change to this file only.
 *
 * TODO(stripe): createPaymentLink -> checkout.sessions.create({mode:'payment', line_items,
 * metadata:{token}, success_url}); handleWebhook -> stripe.webhooks.constructEvent(rawBody,
 * signature header, STRIPE_WEBHOOK_SECRET), map "checkout.session.completed" to {kind:'paid',
 * token: session.metadata.token, providerRef: session.payment_intent}.
 */
export function createStripeProvider(cfg: {
  secretKey?: string
  webhookSecret?: string
}): PaymentProvider {
  return {
    name: 'stripe',
    capabilities: () => ({
      enabled: false,
      hostedPage: true,
      webhooks: true,
      note: cfg.secretKey ? 'billing.provider.notIntegrated' : 'billing.provider.missingKeys',
    }),
    async createPaymentLink() {
      throw new Error('stripe payment provider is not integrated yet')
    },
    async handleWebhook() {
      return null
    },
  }
}
