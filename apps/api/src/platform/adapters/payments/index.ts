import { config } from '../../config.js'
import type { PaymentProvider, PaymentProviderName } from '../../ports/PaymentProvider.js'
import { noneProvider } from './none.js'
import { demoProvider } from './demo.js'
import { createIrisProvider } from './iris.js'
import { createStripeProvider } from './stripe.js'

const providers: Record<PaymentProviderName, PaymentProvider> = {
  none: noneProvider,
  demo: demoProvider,
  iris: createIrisProvider({
    apiKey: config.IRIS_API_KEY,
    webhookSecret: config.IRIS_WEBHOOK_SECRET,
  }),
  stripe: createStripeProvider({
    secretKey: config.STRIPE_SECRET_KEY,
    webhookSecret: config.STRIPE_WEBHOOK_SECRET,
  }),
}

export function paymentProvider(name: string): PaymentProvider {
  return providers[name as PaymentProviderName] ?? noneProvider
}

export function listPaymentProviders(): PaymentProvider[] {
  return Object.values(providers)
}
