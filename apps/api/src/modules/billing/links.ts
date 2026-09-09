import { randomBytes } from 'node:crypto'
import type { PaymentDto, PaymentLinkDto, TenantDto } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf, systemActorOf, systemCtx } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import type { AuditActor } from '../../platform/audit.js'
import { clock, todayInSofia } from '../../platform/clock.js'
import { logger } from '../../platform/logger.js'
import { paymentProvider } from '../../platform/adapters/payments/index.js'
import type { WebhookRequest } from '../../platform/ports/PaymentProvider.js'
import { getTenant, getTenantFeatures, getTenantSettings } from '../tenancy/index.js'
import * as repo from './repo/billing.js'
import * as links from './repo/imports.js'
import type { InvoiceRow } from './repo/billing.js'
import { openCentsOf } from './domain/states.js'
import {
  providerStateFor,
  recordPayment,
  rollStatuses,
  toLinkDto,
  toPaymentDto,
} from './service.js'

const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * A hosted-page link for an open invoice through the tenant's provider (ADR 0001 section 3).
 * `actor` overrides the audit actor (the building's statement page acts as the system).
 */
export async function createPaymentLink(
  ctx: Ctx,
  invoiceId: string,
  actor: AuditActor = actorOf(ctx),
): Promise<PaymentLinkDto> {
  await rollStatuses(ctx.tenantId)
  const inv = await repo.findInvoice(ctx.tenantId, invoiceId)
  if (!inv) throw notFound()
  const open = openCentsOf(inv)
  if (open <= 0) throw new AppError(409, 'billing.invoiceNotOpen')
  const [settings, features] = await Promise.all([
    getTenantSettings(ctx.tenantId),
    getTenantFeatures(ctx.tenantId),
  ])
  const state = providerStateFor(settings, features)
  if (state.name === 'none') throw new AppError(409, 'billing.provider.none')
  if (!state.enabled) throw new AppError(409, state.note ?? 'billing.provider.disabled')
  const existing = await links.openLinksForInvoice(ctx.tenantId, invoiceId)
  const reusable = existing.find(
    (l) => l.amountCents === open && l.expiresAt.getTime() > clock.now().getTime(),
  )
  if (reusable) return toLinkDto(reusable)
  const token = randomBytes(16).toString('hex')
  const out = await paymentProvider(state.name).createPaymentLink({
    tenantId: ctx.tenantId,
    invoiceId,
    token,
    amountCents: open,
    currency: 'EUR',
    reference: inv.paymentReference,
    description: `${inv.paymentReference} · ${inv.building?.addressText ?? ''}`,
  })
  const row = await links.createLink(ctx.tenantId, {
    invoiceId,
    provider: out.provider,
    token,
    url: out.url,
    amountCents: open,
    expiresAt: new Date(clock.now().getTime() + LINK_TTL_MS),
  })
  await audit(actor, {
    action: 'payment_link.create',
    entityType: 'invoice',
    entityId: invoiceId,
    after: { linkId: row.id, provider: out.provider, amountCents: open },
  })
  return toLinkDto(row)
}

export interface ResolvedDemoLink {
  link: links.LinkRow
  invoice: InvoiceRow
  tenant: TenantDto
  paid: boolean
}

/**
 * The public demo page resolves its token here: the link must exist, belong to a tenant with
 * demoMode on (the only tenants allowed to use the demo adapter), and not be expired.
 */
export async function resolveDemoLink(token: string): Promise<ResolvedDemoLink | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null
  const row = await links.findLinkByToken(token)
  if (!row || row.provider !== 'demo') return null
  const features = await getTenantFeatures(row.tenantId)
  if (!features.demoMode) return null
  if (row.status === 'expired' || row.expiresAt.getTime() < clock.now().getTime()) return null
  const tenant = await getTenant(row.tenantId)
  const { invoice: _invoice, ...link } = row
  return { link, invoice: row.invoice, tenant, paid: row.status === 'paid' }
}

/** The demo card form was submitted: one provider payment, idempotent per link. */
export async function settleDemoLink(
  token: string,
  meta: { cardName: string },
): Promise<PaymentDto> {
  const r = await resolveDemoLink(token)
  if (!r) throw notFound()
  const tenantId = r.link.tenantId
  if (r.paid) {
    const existing = await repo.findPaymentByProviderRef(
      tenantId,
      'demo',
      `demo_${token.slice(0, 12)}`,
    )
    if (existing) return toPaymentDto((await repo.findPayment(tenantId, existing.id))!)
  }
  const ctx = systemCtx(tenantId, r.tenant.locale, 'pay.demo')
  const inv = await repo.findInvoice(tenantId, r.invoice.id)
  const stillOpen = inv ? openCentsOf(inv) : 0
  const result = await recordPayment(
    ctx,
    {
      invoiceId: stillOpen > 0 ? r.invoice.id : null,
      buildingId: r.invoice.buildingId,
      amountCents: r.link.amountCents,
      paidAt: todayInSofia(),
      method: 'other',
      note: `demo card payment · ${meta.cardName.slice(0, 80)}`,
      reference: r.invoice.paymentReference,
      source: 'provider',
      provider: 'demo',
      providerRef: `demo_${token.slice(0, 12)}`,
      counterparty: meta.cardName.slice(0, 200) || null,
    },
    systemActorOf(tenantId),
  )
  await links.updateLink(tenantId, r.link.id, {
    status: 'paid',
    paidAt: clock.now(),
    providerRef: `demo_${token.slice(0, 12)}`,
  })
  return toPaymentDto(result.payment)
}

/** Webhook facade: the adapter parses and verifies; a paid event settles the link once. */
export async function handleWebhook(
  providerName: string,
  req: WebhookRequest,
): Promise<{ handled: boolean; reason?: string }> {
  const provider = paymentProvider(providerName)
  if (provider.name !== providerName || !provider.capabilities().webhooks)
    return { handled: false, reason: 'unknown provider' }
  const event = await provider.handleWebhook(req)
  if (!event) return { handled: false, reason: 'not a payment event' }
  if (event.kind !== 'paid' || !event.token) return { handled: true }
  const row = await links.findLinkByToken(event.token)
  if (!row || row.provider !== providerName) return { handled: false, reason: 'unknown link' }
  if (row.status === 'paid') return { handled: true }
  const tenant = await getTenant(row.tenantId)
  const ctx = systemCtx(row.tenantId, tenant.locale, `webhook.${providerName}`)
  const inv = await repo.findInvoice(row.tenantId, row.invoiceId)
  await recordPayment(
    ctx,
    {
      invoiceId: inv && openCentsOf(inv) > 0 ? inv.id : null,
      buildingId: row.invoice.buildingId,
      amountCents: event.amountCents || row.amountCents,
      paidAt: todayInSofia(),
      method: 'other',
      note: `${providerName} payment`,
      reference: row.invoice.paymentReference,
      source: 'provider',
      provider: providerName,
      providerRef: event.providerRef,
    },
    systemActorOf(row.tenantId),
  )
  await links.updateLink(row.tenantId, row.id, {
    status: 'paid',
    paidAt: event.at,
    providerRef: event.providerRef,
  })
  logger.info({ provider: providerName, linkId: row.id }, 'payment link settled by webhook')
  return { handled: true }
}
