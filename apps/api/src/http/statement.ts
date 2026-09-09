import { Router } from 'express'
import type { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { formatDate, formatDateTime, formatMoney } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'
import type {
  BuildingStatementDto,
  CallbackDto,
  DefectDto,
  TenantDto,
  VisitDto,
} from '@avroleva/contracts'
import { config } from '../platform/config.js'
import { addDays, todayInSofia } from '../platform/clock.js'
import { systemActorOf, systemCtx } from '../platform/http/ctx.js'
import type { Ctx } from '../platform/http/ctx.js'
import { AppError } from '../platform/http/errors.js'
import { createT } from '../platform/i18n.js'
import { logger } from '../platform/logger.js'
import { getTenant, getTenantFeatures, getTenantSettings } from '../modules/tenancy/index.js'
import { buildings } from '../modules/registry/index.js'
import * as visits from '../modules/visits/index.js'
import * as callbacks from '../modules/callbacks/index.js'
import * as defects from '../modules/defects/index.js'
import * as billing from '../modules/billing/index.js'
import { esc, page } from './templates/html.js'

/**
 * Building statement page behind a magic link (`/s/:token`, step 9). No login: the 128-bit
 * access-link token is the authorisation (like `/p/:token` and `/pay/demo/:token`). Server-
 * rendered, mobile-first, Cyrillic-safe, `noindex`, `no-store`. Shows the firm, the building,
 * the current balance, the open invoices with the bank block + EPC QR (this page is explicit
 * consent, so money shows regardless of `showPaymentOnPublicPage`), the payment history and,
 * with scope `statement_and_visits`, the last 12 months of visits / callbacks / open defects and
 * the next inspection. No building contact data. Opens are counted on the link row only.
 */
export const statementRouter = Router()

const pageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  handler: (_req, res) => res.status(429).type('text').send('Too many requests'),
})
const payLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  handler: (_req, res) => res.status(429).type('text').send('Too many requests'),
})

const CSS = `
  body { background: #f8fafc; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 16px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  .card h2 { font-size: 1.05em; margin-bottom: 10px; }
  .firm { font-size: 1.1em; font-weight: 700; }
  .phones { color: #555; font-size: .9em; margin-top: 4px; }
  .phones a { color: #1d4ed8; text-decoration: none; font-weight: 600; }
  .emg { color: #b91c1c; font-weight: 700; }
  .title { font-size: 1.3em; font-weight: 800; margin: 14px 0 2px; }
  .balance { font-size: 1.8em; font-weight: 800; margin: 4px 0; }
  .balance.due { color: #b91c1c; } .balance.ok { color: #166534; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
  dt { color: #555; } dd { margin: 0; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; font-size: .9em; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 4px; text-align: left; vertical-align: top; }
  th { color: #555; font-weight: 600; font-size: .85em; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; }
  .scroll { overflow-x: auto; }
  .status { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: .8em; font-weight: 700; background: #e5e7eb; }
  .status.stop { background: #fee2e2; color: #991b1b; }
  .pay { display: flex; gap: 14px; align-items: flex-start; margin-top: 12px; }
  .pay svg { width: 120px; height: 120px; flex: none; }
  .iban { font-family: ui-monospace, Consolas, monospace; font-size: 1.05em; letter-spacing: .04em; }
  .ref { font-family: ui-monospace, Consolas, monospace; font-weight: 700; }
  .copy { font: inherit; font-size: .8em; padding: 2px 8px; border: 1px solid #1d4ed8; border-radius: 4px; background: #fff; color: #1d4ed8; cursor: pointer; margin-left: 6px; }
  form.pay-form { display: inline; margin: 0; }
  .btn.pay-btn { padding: 4px 10px; font-size: .85em; width: auto; }
  .err { background: #fee2e2; color: #991b1b; padding: 10px 12px; border-radius: 8px; margin-bottom: 10px; }
  .empty { color: #777; font-size: .9em; }
  footer { color: #777; font-size: .8em; text-align: center; padding: 12px; }
`

function tokenOf(req: Request): string {
  const raw = req.params.token
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ''))
}

function paramOf(req: Request, name: string): string {
  const raw = req.params[name]
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ''))
}

function base(): string {
  return config.BASE_PATH === '/' ? '' : config.BASE_PATH
}

function notFoundPage(res: Response) {
  const t = createT('bg')
  res
    .status(404)
    .type('html')
    .send(
      page({
        title: t('statementPage.notFoundTitle'),
        css: CSS,
        robots: 'noindex, nofollow',
        body: `<div class="wrap"><div class="card"><h1>${esc(t('statementPage.notFoundTitle'))}</h1><p>${esc(t('statementPage.notFoundText'))}</p></div></div>`,
      }),
    )
}

interface Resolved {
  link: billing.ResolvedAccessLink
  tenant: TenantDto
  ctx: Ctx
  t: T
  locale: string
}

async function resolve(req: Request): Promise<Resolved | null> {
  const link = await billing.resolveAccessLink(tokenOf(req))
  if (!link) return null
  const tenant = await getTenant(link.tenantId)
  const ctx = systemCtx(link.tenantId, tenant.locale, req.requestId ?? 'public.statement')
  return { link, tenant, ctx, t: ctx.t, locale: tenant.locale }
}

interface Extras {
  visits: VisitDto[]
  callbacks: CallbackDto[]
  defects: DefectDto[]
  nextInspectionAt: string | null
}

async function loadExtras(r: Resolved): Promise<Extras> {
  const { ctx, link } = r
  const today = todayInSofia()
  const fromDay = addDays(today, -365)
  const from = new Date(fromDay + 'T00:00:00Z')
  const to = new Date(addDays(today, 1) + 'T00:00:00Z')
  const [visitRows, cbPage, defectPage, detail] = await Promise.all([
    visits.listForBuildingPeriod(link.tenantId, link.buildingId, from, to),
    callbacks.list(ctx, { limit: 100, buildingId: link.buildingId, from: fromDay }),
    defects.list(ctx, { limit: 100, buildingId: link.buildingId, open: true }),
    buildings.get(ctx, link.buildingId),
  ])
  const inspections = detail.elevators
    .filter((e) => e.status !== 'scrapped' && e.nextInspectionAt)
    .map((e) => e.nextInspectionAt!)
    .sort()
  return {
    visits: [...visitRows].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    callbacks: cbPage.items,
    defects: defectPage.items,
    nextInspectionAt: inspections[0] ?? null,
  }
}

function openInvoicesCard(
  r: Resolved,
  s: BuildingStatementDto,
  payEnabled: boolean,
  error: string | undefined,
): string {
  const { t, locale, link } = r
  const money = (c: number) => formatMoney(c, locale)
  const openTotal = s.openInvoices.reduce((a, i) => a + i.openCents, 0)
  const rows = s.openInvoices
    .map(
      (i) =>
        `<tr><td>${esc(i.number)}</td><td>${esc(i.period ?? '')}</td><td>${esc(i.dueAt ? formatDate(i.dueAt, locale) : '—')}</td><td class="num">${esc(money(i.openCents))}</td>${
          payEnabled
            ? `<td class="num"><form class="pay-form" method="post" action="${esc(`${base()}/s/${link.token}/pay/${i.id}`)}"><button class="btn pay-btn" type="submit">${esc(t('statementPage.pay'))}</button></form></td>`
            : ''
        }</tr>`,
    )
    .join('')
  const table = s.openInvoices.length
    ? `<div class="scroll"><table>
        <thead><tr><th>№</th><th>${esc(t('statementPage.period'))}</th><th>${esc(t('statementPage.dueAt'))}</th><th class="num">${esc(t('statementPage.open'))}</th>${payEnabled ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows}<tr class="total"><td colspan="3">${esc(t('statementPage.total'))}</td><td class="num">${esc(money(openTotal))}</td>${payEnabled ? '<td></td>' : ''}</tr></tbody>
      </table></div>`
    : `<p class="empty">${esc(t('statementPage.noOpen'))}</p>`
  const block =
    openTotal > 0 && s.bank
      ? billing.payBlock(t, s.bank, s.epc, s.epc?.reference ?? '', money(openTotal))
      : ''
  return `<div class="card">
    <h2>${esc(t('statementPage.openInvoices'))}</h2>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    ${table}
    ${payEnabled && s.openInvoices.length ? `<p class="small muted">${esc(t('statementPage.payHint'))}</p>` : ''}
    ${block}
  </div>`
}

function historyCard(r: Resolved, s: BuildingStatementDto): string {
  const { t, locale } = r
  const money = (c: number) => formatMoney(c, locale)
  const lines = [...s.lines].reverse()
  const rows = lines
    .map(
      (l) =>
        `<tr><td>${esc(formatDate(l.date, locale))}</td><td>${esc(l.description)}</td><td class="num">${l.debitCents ? esc(money(l.debitCents)) : ''}</td><td class="num">${l.creditCents ? esc(money(l.creditCents)) : ''}</td><td class="num">${esc(money(l.balanceCents))}</td></tr>`,
    )
    .join('')
  return `<div class="card">
    <h2>${esc(t('statementPage.history'))}</h2>
    <p class="small muted">${esc(t('statementPage.window', { from: formatDate(s.from, locale), to: formatDate(s.to, locale) }))}</p>
    ${
      rows
        ? `<div class="scroll"><table>
        <thead><tr><th>${esc(t('statementPage.date'))}</th><th>${esc(t('statementPage.description'))}</th><th class="num">${esc(t('statementPage.debit'))}</th><th class="num">${esc(t('statementPage.credit'))}</th><th class="num">${esc(t('statementPage.balanceCol'))}</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
        : `<p class="empty">${esc(t('statementPage.noHistory'))}</p>`
    }
  </div>`
}

function visitsCards(r: Resolved, x: Extras): string {
  const { t, locale } = r
  const visitRows = x.visits
    .map(
      (v) =>
        `<tr><td>${esc(formatDateTime(v.startedAt, locale))}</td><td>${esc(t(`enum.visitKind.${v.kind}`))}</td><td>${esc(v.technicians.map((p) => p.name).join(', '))}</td></tr>`,
    )
    .join('')
  const cbRows = x.callbacks
    .map(
      (c) =>
        `<tr><td>${esc(formatDateTime(c.receivedAt, locale))}</td><td>${esc(t(`enum.callbackClassification.${c.classification}`))}</td><td class="num">${c.responseMinutes != null ? esc(t('statementPage.minutes', { n: c.responseMinutes })) : '—'}</td><td><span class="status">${esc(t(`enum.callbackStatus.${c.status}`))}</span></td></tr>`,
    )
    .join('')
  const defectRows = x.defects
    .map(
      (d) =>
        `<tr><td>${esc(formatDate(d.recordedAt, locale))}</td><td>${esc(d.catalogRef ? `${d.catalogRef} · ${d.description}` : d.description)}${d.stopLift ? ` <span class="status stop">${esc(t('statementPage.stopLift'))}</span>` : ''}</td></tr>`,
    )
    .join('')
  const inspection = x.nextInspectionAt
    ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(x.nextInspectionAt + 'T00:00:00Z'),
      )
    : t('statementPage.noInspection')
  return `<div class="card">
    <h2>${esc(t('statementPage.visits'))}</h2>
    ${
      visitRows
        ? `<div class="scroll"><table><thead><tr><th>${esc(t('statementPage.date'))}</th><th>${esc(t('statementPage.visitKind'))}</th><th>${esc(t('statementPage.technicians'))}</th></tr></thead><tbody>${visitRows}</tbody></table></div>`
        : `<p class="empty">${esc(t('statementPage.noVisits'))}</p>`
    }
  </div>
  <div class="card">
    <h2>${esc(t('statementPage.callbacks'))}</h2>
    ${
      cbRows
        ? `<div class="scroll"><table><thead><tr><th>${esc(t('statementPage.receivedAt'))}</th><th>${esc(t('statementPage.classification'))}</th><th class="num">${esc(t('statementPage.responseTime'))}</th><th>${esc(t('statementPage.status'))}</th></tr></thead><tbody>${cbRows}</tbody></table></div>`
        : `<p class="empty">${esc(t('statementPage.noCallbacks'))}</p>`
    }
  </div>
  <div class="card">
    <h2>${esc(t('statementPage.defects'))}</h2>
    <dl><dt>${esc(t('statementPage.nextInspection'))}</dt><dd>${esc(inspection)}</dd></dl>
    ${
      defectRows
        ? `<div class="scroll" style="margin-top:10px"><table><thead><tr><th>${esc(t('statementPage.defectFoundAt'))}</th><th>${esc(t('statementPage.description'))}</th></tr></thead><tbody>${defectRows}</tbody></table></div>`
        : `<p class="empty" style="margin-top:10px">${esc(t('statementPage.noDefects'))}</p>`
    }
  </div>`
}

async function render(r: Resolved, opts: { error?: string } = {}): Promise<string> {
  const { tenant, link, ctx, t, locale } = r
  const [s, settings, features] = await Promise.all([
    billing.statement(ctx, link.buildingId, {}),
    getTenantSettings(link.tenantId),
    getTenantFeatures(link.tenantId),
  ])
  const payEnabled = billing.providerStateFor(settings, features).enabled
  const extras = link.scope === 'statement_and_visits' ? await loadExtras(r) : null
  const tel = tenant.emergencyPhone.replace(/\s+/g, '')
  const balance = s.closingBalanceCents
  const hasBank = !!s.bank && s.openInvoices.length > 0
  return page({
    title: `${t('statementPage.title')} · ${s.buildingAddressText}`,
    lang: locale,
    css: CSS,
    robots: 'noindex, nofollow',
    body: `<div class="wrap">
      <div class="card">
        <div class="firm">${esc(tenant.name)}</div>
        <div class="phones">${esc(t('statementPage.phone'))}: <a href="tel:${esc(tenant.phone.replace(/\s+/g, ''))}">${esc(tenant.phone)}</a> · <span class="emg">${esc(t('statementPage.emergency'))}:</span> <a href="tel:${esc(tel)}">${esc(tenant.emergencyPhone)}</a></div>
        <div class="title">${esc(t('statementPage.title'))}</div>
        <dl>
          <dt>${esc(t('statementPage.address'))}</dt><dd>${esc(s.buildingAddressText)}</dd>
          ${s.customerName ? `<dt>${esc(t('statementPage.customer'))}</dt><dd>${esc(s.customerName)}</dd>` : ''}
        </dl>
      </div>
      <div class="card">
        <h2>${esc(t('statementPage.balance'))}</h2>
        <div class="balance ${balance > 0 ? 'due' : 'ok'}">${esc(formatMoney(balance, locale))}</div>
        <div class="small muted">${esc(t('statementPage.asOf', { date: formatDate(s.to, locale) }))}${balance > 0 ? ` · ${esc(t('statementPage.due'))}` : ` · ${esc(t('statementPage.settled'))}`}</div>
      </div>
      ${openInvoicesCard(r, s, payEnabled, opts.error)}
      ${historyCard(r, s)}
      ${extras ? visitsCards(r, extras) : ''}
      <footer>${esc(t('statementPage.footer'))}<br>${esc(t('statementPage.validUntil', { date: formatDate(link.expiresAt, locale) }))}</footer>
    </div>`,
    script: hasBank ? `${base()}/print/assets/print.js` : undefined,
  })
}

statementRouter.get('/:token', pageLimiter, async (req, res) => {
  const r = await resolve(req)
  if (!r) return notFoundPage(res)
  res.setHeader('Cache-Control', 'no-store')
  await billing.recordAccessLinkOpen(r.link, req.ip)
  res.type('html').send(await render(r))
})

/**
 * "Плати": a hosted-page link for one open invoice of the link's building through the tenant's
 * provider, then a redirect to it. The token is the authorisation (no CSRF header: the form is
 * this page's own). 10 attempts per hour per IP.
 */
statementRouter.post('/:token/pay/:invoiceId', payLimiter, async (req, res) => {
  const r = await resolve(req)
  if (!r) return notFoundPage(res)
  res.setHeader('Cache-Control', 'no-store')
  const invoiceId = paramOf(req, 'invoiceId')
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return notFoundPage(res)
  const { ctx, link, t } = r
  try {
    const inv = await billing.get(ctx, invoiceId)
    if (inv.buildingId !== link.buildingId) return notFoundPage(res)
    const pl = await billing.createPaymentLink(ctx, invoiceId, {
      ...systemActorOf(link.tenantId),
      requestId: req.requestId ?? 'public.statement',
      ip: req.ip,
    })
    logger.info({ linkId: link.id, invoiceId }, 'statement page payment link')
    return res.redirect(303, pl.url)
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return notFoundPage(res)
    const code = err instanceof AppError ? err.code : 'statementPage.payError'
    logger.warn({ err, linkId: link.id, invoiceId }, 'statement page payment link failed')
    return res
      .status(err instanceof AppError ? err.status : 500)
      .type('html')
      .send(await render(r, { error: t(code) }))
  }
})
