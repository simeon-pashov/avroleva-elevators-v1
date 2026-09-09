/**
 * Payment provider port (ARCHITECTURE A1, ADR 0001 section 3). Adapters in
 * platform/adapters/payments: `none` (bank transfer only), `demo` (fake hosted page, demoMode
 * tenants only), `iris` and `stripe` (wired stubs, enabled:false until an integration is
 * contracted). Which adapter a tenant uses is `tenant.settings.billing.paymentProvider`.
 */
export type PaymentProviderName = 'none' | 'demo' | 'iris' | 'stripe'

export interface PaymentCapabilities {
  enabled: boolean
  hostedPage: boolean
  webhooks: boolean
  /** i18n key or short English note shown next to the provider in settings. */
  note: string | null
}

export interface PaymentLinkInput {
  tenantId: string
  invoiceId: string
  /** Our token; the hosted page URL and the webhook correlate on it. */
  token: string
  amountCents: number
  currency: 'EUR'
  reference: string
  description: string
}

export interface PaymentLinkOutput {
  url: string
  provider: PaymentProviderName
  providerRef?: string | null
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>
  rawBody: string
  query: Record<string, unknown>
}

export interface PaymentEvent {
  kind: 'paid' | 'failed'
  /** Our token when the provider echoes it back; otherwise the providerRef of the link. */
  token: string | null
  providerRef: string | null
  amountCents: number
  at: Date
}

export interface PaymentProvider {
  readonly name: PaymentProviderName
  capabilities(): PaymentCapabilities
  createPaymentLink(input: PaymentLinkInput): Promise<PaymentLinkOutput>
  /** Verifies and parses a webhook; null = not a payment event (or signature rejected). */
  handleWebhook(req: WebhookRequest): Promise<PaymentEvent | null>
}
