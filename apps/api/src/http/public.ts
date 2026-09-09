import { Router } from 'express'
import type { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { formatDate } from '@avroleva/i18n'
import { config } from '../platform/config.js'
import { clock, toDateOnly } from '../platform/clock.js'
import { createT } from '../platform/i18n.js'
import { logger } from '../platform/logger.js'
import { getTenant, getTenantFeatures } from '../modules/tenancy/index.js'
import { elevators } from '../modules/registry/index.js'
import { latestVisitAt } from '../modules/visits/index.js'
import * as callbacks from '../modules/callbacks/index.js'
import * as billing from '../modules/billing/index.js'
import { formatMoney } from '@avroleva/i18n'
import { esc, page } from './templates/html.js'

/**
 * Public QR page (`/p/:token`) and fault-report form. No auth: the tenant is resolved from the
 * elevator's public token (128 bits). Server-rendered, mobile-first, no SPA, no personal data
 * beyond the firm's emergency phone. Feature flags `publicQrPage` / `publicFaultReport` per tenant.
 * Limits: 20 reports / h per IP (express-rate-limit) and 5 / h per elevator (in-memory), honeypot
 * field, no captcha.
 */
export const publicRouter = Router()

const ipLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  handler: (_req, res) => res.status(429).type('text').send('Too many requests'),
})
const pageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  handler: (_req, res) => res.status(429).type('text').send('Too many requests'),
})

/** 5 reports per elevator per hour, whatever the IP (a shared building Wi-Fi is one IP anyway). */
const PER_ELEVATOR_LIMIT = 5
const perElevator = new Map<string, number[]>()
export function elevatorLimitHit(elevatorId: string, now = clock.now()): boolean {
  const cutoff = now.getTime() - 60 * 60 * 1000
  const hits = (perElevator.get(elevatorId) ?? []).filter((t) => t > cutoff)
  if (hits.length >= PER_ELEVATOR_LIMIT) {
    perElevator.set(elevatorId, hits)
    return true
  }
  hits.push(now.getTime())
  perElevator.set(elevatorId, hits)
  return false
}
/** Test hook. */
export function resetElevatorLimits(): void {
  perElevator.clear()
}

const CSS = `
  body { background: #f8fafc; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  .firm { font-size: 1.1em; font-weight: 700; }
  .emg { color: #b91c1c; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; font-size: .8em; margin-top: 8px; }
  .call { display: block; text-align: center; font-size: 1.6em; font-weight: 800; padding: 14px; border-radius: 10px; background: #dc2626; color: #fff; text-decoration: none; margin: 8px 0 4px; }
  .call small { display: block; font-size: .5em; font-weight: 500; opacity: .9; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
  dt { color: #555; } dd { margin: 0; font-weight: 600; }
  .status { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .85em; font-weight: 700; }
  .status.ok { background: #dcfce7; color: #166534; } .status.off { background: #fee2e2; color: #991b1b; }
  label { display: block; margin: 10px 0 4px; font-weight: 600; }
  input[type=text], input[type=tel], textarea { width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
  .chk { display: flex; gap: 10px; align-items: center; margin: 12px 0; font-weight: 600; }
  .btn { width: 100%; margin-top: 12px; font-size: 1.05em; padding: 12px; }
  .hp { position: absolute; left: -10000px; top: auto; width: 1px; height: 1px; overflow: hidden; }
  .err { background: #fee2e2; color: #991b1b; padding: 10px 12px; border-radius: 8px; margin-bottom: 10px; }
  .ok-box { background: #dcfce7; color: #166534; padding: 12px; border-radius: 8px; font-weight: 600; }
  footer { color: #777; font-size: .8em; text-align: center; padding: 12px; }
  .pay { display: flex; gap: 14px; align-items: flex-start; }
  .pay svg { width: 120px; height: 120px; flex: none; }
  .iban { font-family: ui-monospace, Consolas, monospace; font-size: 1.05em; letter-spacing: .04em; }
  .ref { font-family: ui-monospace, Consolas, monospace; font-weight: 700; }
  .copy { font: inherit; font-size: .8em; padding: 2px 8px; border: 1px solid #1d4ed8; border-radius: 4px; background: #fff; color: #1d4ed8; cursor: pointer; margin-left: 6px; }
`

async function resolve(req: Request) {
  const raw = req.params.token
  const token = Array.isArray(raw) ? raw[0] : raw
  const e = await elevators.findByPublicToken(token ?? '')
  if (!e) return null
  const features = await getTenantFeatures(e.tenantId)
  if (!features.publicQrPage) return null
  const tenant = await getTenant(e.tenantId)
  return { e, tenant, features, t: createT(tenant.locale) }
}

function notFoundPage(res: Response) {
  const t = createT('bg')
  res
    .status(404)
    .type('html')
    .send(
      page({
        title: t('public.notFoundTitle'),
        css: CSS,
        robots: 'noindex',
        body: `<div class="wrap"><div class="card"><h1>${esc(t('public.notFoundTitle'))}</h1><p>${esc(t('public.notFoundText'))}</p></div></div>`,
      }),
    )
}

type Resolved = NonNullable<Awaited<ReturnType<typeof resolve>>>

async function render(
  r: Resolved,
  opts: { error?: string; done?: boolean; values?: Record<string, string> } = {},
) {
  const { e, tenant, features, t } = r
  const locale = tenant.locale
  const lastVisit = await latestVisitAt(e.tenantId, e.id)
  const inService = e.status === 'active'
  const nextInspection = toDateOnly(e.nextInspectionAt)
  const nextInspectionLabel = nextInspection
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(nextInspection + 'T00:00:00Z'),
      )
    : '—'
  const v = opts.values ?? {}
  const tel = tenant.emergencyPhone.replace(/\s+/g, '')
  const pay = await billing.publicPayment(e.tenantId, e.buildingId)
  const payCard = pay
    ? `<div class="card"><h2>${esc(t('public.payTitle'))}</h2><p class="small muted">${esc(t('public.payHint', { count: pay.openCount }))}</p>${billing.payBlock(t, pay.bank, pay.epc, pay.reference, formatMoney(pay.openCents, locale))}</div>`
    : ''
  const form = features.publicFaultReport
    ? opts.done
      ? `<div class="card"><div class="ok-box">${esc(t('public.thanks'))}</div><p class="small muted" style="margin-top:10px">${esc(t('public.thanksHint'))}</p></div>`
      : `<div class="card">
      <h2>${esc(t('public.reportTitle'))}</h2>
      <p class="small muted">${esc(t('public.reportHint'))}</p>
      ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ''}
      <form method="post" action="${esc(e.publicToken)}/report">
        <div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <label for="f-name">${esc(t('public.name'))}</label>
        <input id="f-name" type="text" name="name" maxlength="120" value="${esc(v.name ?? '')}" autocomplete="name">
        <label for="f-phone">${esc(t('public.phone'))}</label>
        <input id="f-phone" type="tel" name="phone" maxlength="25" value="${esc(v.phone ?? '')}" autocomplete="tel">
        <label for="f-desc">${esc(t('public.description'))} *</label>
        <textarea id="f-desc" name="description" rows="4" maxlength="2000" required>${esc(v.description ?? '')}</textarea>
        <label class="chk"><input type="checkbox" name="trapped" value="1" ${v.trapped ? 'checked' : ''}> ${esc(t('public.trapped'))}</label>
        <button class="btn" type="submit">${esc(t('public.send'))}</button>
      </form>
    </div>`
    : ''
  return page({
    title: `${tenant.name} · ${e.internalNo}`,
    lang: locale,
    css: CSS,
    robots: 'noindex, nofollow',
    body: `<div class="wrap">
      <div class="card">
        <div class="firm">${esc(tenant.name)}</div>
        <div class="emg">${esc(t('public.emergency'))}</div>
        <a class="call" href="tel:${esc(tel)}">${esc(tenant.emergencyPhone)}<small>${esc(t('public.callHint'))}</small></a>
      </div>
      <div class="card">
        <dl>
          <dt>${esc(t('public.address'))}</dt><dd>${esc(e.building.addressText)}</dd>
          <dt>${esc(t('elevators.one'))}</dt><dd>${esc(e.internalNo)}</dd>
          <dt>${esc(t('public.status'))}</dt><dd><span class="status ${inService ? 'ok' : 'off'}">${esc(t(inService ? 'public.inService' : 'public.outOfService'))}</span></dd>
          <dt>${esc(t('public.lastVisit'))}</dt><dd>${esc(lastVisit ? formatDate(lastVisit, locale) : '—')}</dd>
          <dt>${esc(t('public.nextInspection'))}</dt><dd>${esc(nextInspectionLabel)}</dd>
        </dl>
      </div>
      ${form}
      ${payCard}
      <footer>${esc(t('public.footer'))}</footer>
    </div>`,
    script: pay
      ? `${config.BASE_PATH === '/' ? '' : config.BASE_PATH}/print/assets/print.js`
      : undefined,
  })
}

publicRouter.get('/:token', pageLimiter, async (req, res) => {
  const r = await resolve(req)
  if (!r) return notFoundPage(res)
  res.setHeader('Cache-Control', 'no-store')
  res.type('html').send(await render(r))
})

const reportBody = z.object({
  website: z.string().optional(),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(25).optional(),
  description: z.string().trim().min(3).max(2000),
  trapped: z.string().optional(),
})

publicRouter.post('/:token/report', ipLimiter, async (req, res) => {
  const r = await resolve(req)
  if (!r || !r.features.publicFaultReport) return notFoundPage(res)
  res.setHeader('Cache-Control', 'no-store')
  const raw = (req.body ?? {}) as Record<string, string>
  const parsed = reportBody.safeParse(raw)
  const { e, t } = r
  // Honeypot filled in = a bot; answer as if it worked, record nothing.
  if (parsed.success && parsed.data.website) {
    logger.warn({ elevatorId: e.id, ip: req.ip }, 'public report honeypot hit')
    return res.type('html').send(await render(r, { done: true }))
  }
  if (!parsed.success) {
    return res
      .status(400)
      .type('html')
      .send(await render(r, { error: t('public.descriptionRequired'), values: raw }))
  }
  if (elevatorLimitHit(e.id)) {
    return res
      .status(429)
      .type('html')
      .send(await render(r, { error: t('public.tooMany'), values: raw }))
  }
  const trapped = parsed.data.trapped === '1' || parsed.data.trapped === 'on'
  try {
    await callbacks.open(
      {
        tenantId: e.tenantId,
        userId: null,
        role: null,
        source: 'public',
        requestId: req.requestId,
        ip: req.ip,
      },
      {
        elevatorId: e.id,
        channel: 'public_page',
        callerName: parsed.data.name || undefined,
        callerPhone: phoneOrNull(parsed.data.phone),
        classification: trapped ? 'trapped_persons' : 'breakdown',
        trappedCount: trapped ? 1 : null,
        description: parsed.data.description,
        assignedUserId: null,
        notes:
          parsed.data.phone && !phoneOrNull(parsed.data.phone)
            ? `${t('public.phone')}: ${parsed.data.phone}`
            : undefined,
      },
    )
  } catch (err) {
    logger.error({ err, elevatorId: e.id }, 'public fault report failed')
    return res
      .status(500)
      .type('html')
      .send(await render(r, { error: t('error.internal'), values: raw }))
  }
  res.type('html').send(await render(r, { done: true }))
})

function phoneOrNull(v: string | undefined): string | null {
  if (!v) return null
  return /^[+0-9 ()./-]{5,25}$/.test(v) ? v : null
}
