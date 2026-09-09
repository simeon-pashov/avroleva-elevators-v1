import { Router } from 'express'
import type { Request, Response } from 'express'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { formatMoney } from '@avroleva/i18n'
import { config } from '../platform/config.js'
import { createT } from '../platform/i18n.js'
import { logger } from '../platform/logger.js'
import * as billing from '../modules/billing/index.js'
import { esc, page } from './templates/html.js'

/**
 * Hosted payment pages and provider webhooks (ADR 0001 section 3).
 * - `/pay/demo/:token`: the demo adapter's fake card form; answers 404 unless the link belongs to
 *   a tenant with `demoMode` on. Nothing is sent anywhere; submitting records a payment with
 *   source=provider, provider=demo, shown with a "demo" badge in the office.
 * - `/webhooks/payments/:provider`: raw-body endpoint the real adapters (iris, stripe) will
 *   verify; the stubs answer 501 until integrated.
 */
export const payRouter = Router()
export const webhookRouter = Router()

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  handler: (_req, res) => res.status(429).type('text').send('Too many requests'),
})

const CSS = `
  body { background: #f8fafc; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 14px; }
  .demo { display: inline-block; background: #fef3c7; color: #92400e; border-radius: 6px; padding: 3px 10px; font-weight: 800; letter-spacing: .06em; font-size: .8em; }
  .amount { font-size: 1.8em; font-weight: 800; margin: 6px 0; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  input { width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
  .row { display: flex; gap: 10px; } .row > div { flex: 1; }
  .btn { width: 100%; margin-top: 16px; font-size: 1.05em; padding: 12px; }
  .ok-box { background: #dcfce7; color: #166534; padding: 12px; border-radius: 8px; font-weight: 600; }
  .muted { color: #555; } .small { font-size: .85em; }
  footer { color: #777; font-size: .8em; text-align: center; padding: 12px; }
`

function tokenOf(req: Request): string {
  const raw = req.params.token
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ''))
}

function notFoundPage(res: Response) {
  const t = createT('bg')
  res
    .status(404)
    .type('html')
    .send(
      page({
        title: t('pay.notFoundTitle'),
        css: CSS,
        robots: 'noindex',
        body: `<div class="wrap"><div class="card"><h1>${esc(t('pay.notFoundTitle'))}</h1><p>${esc(t('pay.notFoundText'))}</p></div></div>`,
      }),
    )
}

function render(r: billing.ResolvedDemoLink, opts: { done?: boolean; error?: string } = {}) {
  const t = createT(r.tenant.locale)
  const locale = r.tenant.locale
  const amount = formatMoney(r.link.amountCents, locale)
  const paid = r.paid || opts.done
  const body = `<div class="wrap">
    <div class="card">
      <span class="demo">${esc(t('pay.demoBadge'))}</span>
      <h1>${esc(t('pay.title'))}</h1>
      <div class="muted">${esc(r.tenant.name)}</div>
      <div class="small muted">${esc(t('pay.invoice'))} № ${esc(r.invoice.number)} · ${esc(r.invoice.paymentReference)}</div>
      <div class="small muted">${esc(r.invoice.building?.addressText ?? '')}</div>
      <div class="amount">${esc(amount)}</div>
      ${
        paid
          ? `<div class="ok-box">${esc(t('pay.thanks'))}</div>`
          : `<form method="post" action="${esc(config.BASE_PATH === '/' ? '' : config.BASE_PATH)}/pay/demo/${esc(r.link.token)}">
        ${opts.error ? `<div class="ok-box" style="background:#fee2e2;color:#991b1b">${esc(opts.error)}</div>` : ''}
        <label for="c-name">${esc(t('pay.cardName'))}</label>
        <input id="c-name" name="cardName" maxlength="80" required autocomplete="cc-name">
        <label for="c-number">${esc(t('pay.cardNumber'))}</label>
        <input id="c-number" name="cardNumber" inputmode="numeric" maxlength="23" placeholder="4242 4242 4242 4242" autocomplete="off">
        <div class="row">
          <div><label for="c-exp">${esc(t('pay.cardExpiry'))}</label><input id="c-exp" name="expiry" maxlength="5" placeholder="12/28" autocomplete="off"></div>
          <div><label for="c-cvc">CVC</label><input id="c-cvc" name="cvc" maxlength="4" placeholder="123" autocomplete="off"></div>
        </div>
        <button class="btn" type="submit">${esc(t('pay.payNow', { amount }))}</button>
        <p class="small muted">${esc(t('pay.demoHint'))}</p>
      </form>`
      }
    </div>
    <footer>${esc(t('pay.footer'))}</footer>
  </div>`
  return page({
    title: `${t('pay.title')} · ${r.tenant.name}`,
    lang: locale,
    css: CSS,
    robots: 'noindex, nofollow',
    body,
  })
}

payRouter.get('/demo/:token', limiter, async (req, res) => {
  const r = await billing.resolveDemoLink(tokenOf(req))
  if (!r) return notFoundPage(res)
  res.setHeader('Cache-Control', 'no-store')
  res.type('html').send(render(r))
})

const cardForm = z.object({
  cardName: z.string().trim().min(2).max(80),
  cardNumber: z.string().trim().max(23).optional(),
})

payRouter.post(
  '/demo/:token',
  limiter,
  express.urlencoded({ extended: false, limit: '8kb' }),
  async (req, res) => {
    const token = tokenOf(req)
    const r = await billing.resolveDemoLink(token)
    if (!r) return notFoundPage(res)
    res.setHeader('Cache-Control', 'no-store')
    const parsed = cardForm.safeParse(req.body ?? {})
    const t = createT(r.tenant.locale)
    if (!parsed.success)
      return res
        .status(400)
        .type('html')
        .send(render(r, { error: t('pay.nameRequired') }))
    // Card data is never stored or logged: only the cardholder name reaches the payment note.
    await billing.settleDemoLink(token, { cardName: parsed.data.cardName })
    res.type('html').send(render(r, { done: true }))
  },
)

/** Raw body: the real adapters verify an HMAC / signature over the exact bytes. */
webhookRouter.post('/:provider', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  const provider = String(req.params.provider ?? '')
  if (!['iris', 'stripe'].includes(provider)) return res.status(404).json({ ok: false })
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
  const result = await billing.handleWebhook(provider, {
    headers: req.headers as Record<string, string | string[] | undefined>,
    rawBody,
    query: req.query as Record<string, unknown>,
  })
  if (!result.handled) {
    logger.info({ provider, reason: result.reason }, 'payment webhook not handled')
    return res.status(501).json({ ok: false, reason: result.reason ?? 'not integrated' })
  }
  res.json({ ok: true })
})
