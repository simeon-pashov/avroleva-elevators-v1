import { Router } from 'express'
import type { Request, Response } from 'express'
import QRCode from 'qrcode'
import { z } from 'zod'
import { isoDate } from '@avroleva/contracts'
import type { DefectDto, ElevatorDetailDto, TenantDto } from '@avroleva/contracts'
import { formatDate } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'
import { addDays, monthBounds, todayInSofia } from '../platform/clock.js'
import { config } from '../platform/config.js'
import type { Ctx } from '../platform/http/ctx.js'
import { AppError } from '../platform/http/errors.js'
import { parseId, parseQuery } from '../platform/http/validate.js'
import { getTenant } from '../modules/tenancy/index.js'
import { buildings, elevators } from '../modules/registry/index.js'
import * as defects from '../modules/defects/index.js'
import { DOC_CSS, esc, page, paragraphs } from './templates/html.js'

/**
 * Printable HTML pages for signed-in office users (print CSS, Cyrillic font stack, no PDF engine):
 * the written notice to the building, the inspection-request letter, QR labels. Mounted at
 * `/print` behind `authenticate` (cookie or bearer; GET only, so no CSRF header is required).
 */
export const printRouter = Router()

const PRINT_JS = `document.addEventListener('DOMContentLoaded',function(){
  for (const b of document.querySelectorAll('[data-print]')) b.addEventListener('click',function(){window.print()});
  if (new URLSearchParams(location.search).get('auto')==='1') setTimeout(function(){window.print()},300);
});`

printRouter.get('/assets/print.js', (_req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'public, max-age=3600')
  res.send(PRINT_JS)
})

function guard(
  req: Request,
  res: Response,
  roles?: Array<'owner' | 'office' | 'technician'>,
): Ctx | null {
  if (!req.ctx) {
    res
      .status(401)
      .type('html')
      .send(
        page({
          title: 'Avroleva',
          body: `<div class="toolbar"><a class="btn" href="${esc(config.BASE_PATH === '/' ? '/login' : `${config.BASE_PATH}/login`)}">${esc('Вход')}</a></div>`,
        }),
      )
    return null
  }
  if (roles && !roles.includes(req.ctx.role)) {
    throw new AppError(403, 'auth.forbidden')
  }
  return req.ctx
}

function toolbar(t: T, extra = ''): string {
  return `<div class="toolbar screen-only"><button type="button" class="btn" data-print>${esc(t('print.print'))}</button>${extra}</div>`
}

function letterhead(tenant: TenantDto): string {
  return `<div class="letterhead">
    <div><div class="firm">${esc(tenant.name)}</div><div class="small">${esc(tenant.address)}</div></div>
    <div class="small" style="text-align:right">${esc(tenant.phone)}${tenant.email ? `<br>${esc(tenant.email)}` : ''}<br>${esc('ЕИК')} ${esc(tenant.eik)}</div>
  </div>`
}

function elevatorRows(t: T, e: ElevatorDetailDto): string {
  const rows: Array<[string, string]> = [
    [t('elevators.address'), e.buildingAddressText],
    [t('elevators.internalNo'), e.internalNo],
  ]
  if (e.regNo) rows.push([t('elevators.regNo'), e.regNo])
  if (e.customerName) rows.push([t('elevators.customer'), e.customerName])
  return `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`
}

// ---- defect notice -----------------------------------------------------------------------------

printRouter.get('/defect-notice/:id', async (req, res) => {
  const ctx = guard(req, res, ['owner', 'office'])
  if (!ctx) return
  const { t, locale } = ctx
  const d: DefectDto = await defects.get(ctx, parseId(req))
  const [e, tenant] = await Promise.all([elevators.get(ctx, d.elevatorId), getTenant(ctx.tenantId)])
  const date = (v: string | null) => (v ? formatDate(v, locale) : '')
  const body = `
  ${toolbar(t)}
  <div class="doc">
    ${letterhead(tenant)}
    <div class="to">
      <div class="muted small">${esc(t('print.to'))}</div>
      <div><strong>${esc(e.customerName ?? t('print.buildingOwners'))}</strong></div>
      ${e.contact ? `<div>${esc(t('print.attn'))} ${esc(e.contact.name)}</div>` : ''}
      <div>${esc(e.buildingAddressText)}</div>
    </div>
    <div class="subject">${esc(t('print.notice.subject'))}</div>
    <p>${esc(t('print.notice.intro', { date: date(d.recordedAt) }))}</p>
    ${elevatorRows(t, e)}
    <div class="box${d.stopLift ? ' warn' : ''}">
      ${d.catalogRef ? `<div class="small muted">${esc(d.catalogRef)}</div>` : ''}
      <div>${esc(d.description)}</div>
    </div>
    ${d.stopLift ? `<p><strong>${esc(t('print.notice.stopped'))}</strong></p>` : ''}
    <p>${esc(t('print.notice.request'))}</p>
    <p>${esc(t('print.notice.contact', { phone: tenant.phone }))}</p>
    ${paragraphs(d.notes)}
    <div class="sign">
      <div><div class="muted small">${esc(t('print.date'))}</div><div>${esc(formatDate(todayInSofia(), locale))}</div></div>
      <div><div class="line">${esc(tenant.name)}</div><div class="small muted">${esc(t('print.signature'))}</div></div>
    </div>
    <div class="footer">${esc(t('print.notice.footer', { id: d.id.slice(-8) }))}</div>
  </div>`
  res.type('html').send(
    page({
      title: t('print.notice.subject'),
      lang: locale,
      css: DOC_CSS,
      body,
      script: '../assets/print.js',
    }),
  )
})

// ---- inspection request letter --------------------------------------------------------------

const windowQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() })

printRouter.get('/inspection-request/:elevatorId', async (req, res) => {
  const ctx = guard(req, res, ['owner', 'office'])
  if (!ctx) return
  const { t, locale } = ctx
  const q = parseQuery(windowQuery, req)
  const e = await elevators.get(ctx, parseId(req, 'elevatorId'))
  const tenant = await getTenant(ctx.tenantId)
  const nextMonth = monthBounds(addDays(monthBounds(todayInSofia().slice(0, 7)).end, 1).slice(0, 7))
  const from =
    q.from ??
    (e.nextInspectionAt && e.nextInspectionAt > todayInSofia()
      ? addDays(e.nextInspectionAt, -30)
      : nextMonth.start)
  const to =
    q.to ??
    (e.nextInspectionAt && e.nextInspectionAt > todayInSofia() ? e.nextInspectionAt : nextMonth.end)
  const body = `
  ${toolbar(t)}
  <div class="doc">
    ${letterhead(tenant)}
    <div class="to">
      <div class="muted small">${esc(t('print.to'))}</div>
      <div><strong>${esc(e.customerName ?? t('print.buildingOwners'))}</strong></div>
      ${e.contact ? `<div>${esc(t('print.attn'))} ${esc(e.contact.name)}</div>` : ''}
      <div>${esc(e.buildingAddressText)}</div>
    </div>
    <div class="subject">${esc(t('print.request.subject'))}</div>
    <p>${esc(t('print.request.intro'))}</p>
    ${elevatorRows(t, e)}
    ${e.nextInspectionAt ? `<p>${esc(t('print.request.due', { date: formatDate(e.nextInspectionAt, locale) }))}</p>` : ''}
    <div class="box">${esc(t('print.request.window', { from: formatDate(from, locale), to: formatDate(to, locale) }))}</div>
    <p>${esc(t('print.request.access'))}</p>
    <p>${esc(t('print.request.contact', { phone: tenant.phone }))}</p>
    <div class="sign">
      <div><div class="muted small">${esc(t('print.date'))}</div><div>${esc(formatDate(todayInSofia(), locale))}</div></div>
      <div><div class="line">${esc(tenant.name)}</div><div class="small muted">${esc(t('print.signature'))}</div></div>
    </div>
  </div>`
  res.type('html').send(
    page({
      title: t('print.request.subject'),
      lang: locale,
      css: DOC_CSS,
      body,
      script: '../assets/print.js',
    }),
  )
})

// ---- QR labels -------------------------------------------------------------------------------

const LABEL_CSS = `
  @page { size: A4; margin: 10mm; }
  body { background: #e5e7eb; }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; max-width: 200mm; margin: 12px auto; }
  .label {
    background: #fff; border: 1.2mm solid #111; border-radius: 3mm; padding: 6mm; height: 128mm;
    display: flex; flex-direction: column; justify-content: space-between; break-inside: avoid;
  }
  .label .firm { font-weight: 700; font-size: 13pt; }
  .label .phone { font-size: 20pt; font-weight: 800; letter-spacing: .02em; }
  .label .phone a { color: inherit; text-decoration: none; }
  .label .emg { font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; color: #b91c1c; font-weight: 700; }
  .label .qr { display: flex; gap: 5mm; align-items: center; }
  .label .qr svg { width: 44mm; height: 44mm; flex: none; }
  .label .addr { font-size: 10.5pt; }
  .label .no { font-size: 13pt; font-weight: 700; }
  .label .hint { font-size: 8.5pt; color: #444; }
  @media print { body { background: #fff; } .sheet { margin: 0; max-width: none; } }
`

async function labelHtml(t: T, tenant: TenantDto, e: ElevatorDetailDto): Promise<string> {
  const svg = await QRCode.toString(e.publicUrl, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  })
  return `<div class="label">
    <div>
      <div class="firm">${esc(tenant.name)}</div>
      <div class="emg">${esc(t('label.emergency'))}</div>
      <div class="phone"><a href="tel:${esc(tenant.emergencyPhone.replace(/\\s+/g, ''))}">${esc(tenant.emergencyPhone)}</a></div>
    </div>
    <div class="qr">${svg}<div><div class="hint">${esc(t('label.scanHint'))}</div></div></div>
    <div>
      <div class="addr">${esc(e.buildingAddressText)}</div>
      <div class="no">${esc(t('elevators.one'))}: ${esc(e.internalNo)}${e.regNo ? ` <span class="small muted">· ${esc(e.regNo)}</span>` : ''}</div>
    </div>
  </div>`
}

printRouter.get('/label/:elevatorId', async (req, res) => {
  const ctx = guard(req, res)
  if (!ctx) return
  const { t, locale } = ctx
  const e = await elevators.get(ctx, parseId(req, 'elevatorId'))
  const tenant = await getTenant(ctx.tenantId)
  const body = `${toolbar(t)}<div class="sheet">${await labelHtml(t, tenant, e)}</div>`
  res.type('html').send(
    page({
      title: `${t('label.title')} · ${e.internalNo}`,
      lang: locale,
      css: LABEL_CSS,
      body,
      script: '../assets/print.js',
    }),
  )
})

printRouter.get('/labels/building/:buildingId', async (req, res) => {
  const ctx = guard(req, res)
  if (!ctx) return
  const { t, locale } = ctx
  const b = await buildings.get(ctx, parseId(req, 'buildingId'))
  const tenant = await getTenant(ctx.tenantId)
  const labels: string[] = []
  for (const el of b.elevators) {
    if (el.status === 'scrapped') continue
    labels.push(await labelHtml(t, tenant, await elevators.get(ctx, el.id)))
  }
  const body = `${toolbar(t, `<span class="small muted">${esc(b.addressText)} · ${labels.length}</span>`)}<div class="sheet">${labels.join('')}</div>`
  res.type('html').send(
    page({
      title: `${t('label.title')} · ${b.addressText}`,
      lang: locale,
      css: LABEL_CSS,
      body,
      script: '../../assets/print.js',
    }),
  )
})
