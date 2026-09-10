import type { JobDetailDto, TenantDto } from '@avroleva/contracts'
import { formatDate, formatMoney, formatNumber } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'

/**
 * Printable quote (оферта): self-contained HTML like the invoice document - inline print CSS,
 * Cyrillic-safe font stack, no external assets. The same HTML goes out as the e-mail attachment.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const QUOTE_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: "Segoe UI", Roboto, "Noto Sans", "DejaVu Sans", Arial, sans-serif; color: #111; background: #fff; font-size: 11pt; line-height: 1.4; }
  h1 { font-size: 18pt; margin: 0 0 4px; } h2 { font-size: 12.5pt; margin: 18px 0 6px; border-bottom: 2px solid #1d4ed8; padding-bottom: 3px; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 12px; }
  .firm { font-weight: 700; font-size: 13pt; } .muted { color: #555; } .small { font-size: 9.5pt; }
  .parties { display: flex; gap: 24px; margin: 10px 0 16px; } .parties > div { flex: 1; }
  .parties .label { font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; font-size: 10pt; }
  th, td { border: 1px solid #d0d5dd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; } td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; background: #f8fafc; }
  .box { border: 1px solid #d0d5dd; border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
  .sign { display: flex; gap: 40px; margin-top: 36px; } .sign > div { flex: 1; }
  .sign .line { border-top: 1px solid #111; margin-top: 30px; padding-top: 4px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 14px; }
  .btn { font: inherit; padding: 6px 12px; border: 1px solid #999; border-radius: 6px; background: #f7f7f7; cursor: pointer; }
  .footer { margin-top: 22px; font-size: 9pt; color: #555; }
  @media print { .screen-only { display: none !important; } body { padding: 0; } }
`

export interface QuoteDocumentOptions {
  toolbar?: boolean
  scriptUrl?: string
  lang?: string
  validUntil?: string | null
  /** Extra message from the office (printed under the lines). */
  message?: string | null
}

export function renderQuoteHtml(
  job: JobDetailDto,
  tenant: TenantDto,
  t: T,
  o: QuoteDocumentOptions = {},
): string {
  const lang = o.lang ?? 'bg'
  const money = (c: number) => formatMoney(c, lang)
  const rows = job.lines
    .map(
      (l, i) =>
        `<tr><td class="num">${i + 1}</td><td>${esc(l.description)}${l.partRef ? `<div class="small muted">${esc(l.partRef)}</div>` : ''}</td><td>${esc(t(`enum.jobLineKind.${l.kind}`))}</td><td class="num">${esc(formatNumber(l.qty, lang, { maximumFractionDigits: 3 }))}</td><td class="num">${esc(money(l.unitCents))}</td><td class="num">${esc(money(l.totalCents))}</td></tr>`,
    )
    .join('')
  const toolbar = o.toolbar
    ? `<div class="toolbar screen-only"><button type="button" class="btn" data-print>${esc(t('print.print'))}</button></div>`
    : ''
  const validity = o.validUntil ?? job.quoteValidUntil
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>${esc(t('jobs.quote.title'))} · ${esc(job.title)}</title><style>${QUOTE_CSS}</style></head><body>
  ${toolbar}
  <div class="head">
    <div><div class="firm">${esc(tenant.name)}</div><div class="small">${esc(tenant.address)}</div><div class="small">${esc(t('print.eik'))} ${esc(tenant.eik)}${tenant.vatNo ? ` · ${esc(t('print.vatNo'))} ${esc(tenant.vatNo)}` : ''}</div></div>
    <div class="small" style="text-align:right">${esc(tenant.phone)}${tenant.email ? `<br>${esc(tenant.email)}` : ''}</div>
  </div>
  <h1>${esc(t('jobs.quote.title'))} № ${esc(job.id.slice(-6).toUpperCase())}${job.quoteVersion > 1 ? ` <span class="muted small">(${esc(t('jobs.quote.version', { n: job.quoteVersion }))})</span>` : ''}</h1>
  <div class="small muted">${esc(t('print.date'))}: ${esc(formatDate(job.quoteSentAt ?? job.updatedAt, lang))}${validity ? ` · ${esc(t('jobs.quote.validUntil', { date: formatDate(validity, lang) }))}` : ''}</div>
  <div class="parties">
    <div><div class="label">${esc(t('print.to'))}</div><div><strong>${esc(job.customerName ?? t('print.buildingOwners'))}</strong></div><div>${esc(job.buildingAddressText)}</div><div class="small">${esc(t('elevators.one'))}: ${esc(job.elevatorInternalNo)}</div></div>
    <div><div class="label">${esc(t('jobs.quote.subject'))}</div><div><strong>${esc(job.title)}</strong></div><div class="small">${esc(t(`enum.jobKind.${job.kind}`))}</div>${job.description ? `<div class="small">${esc(job.description)}</div>` : ''}</div>
  </div>
  <table>
    <thead><tr><th class="num">№</th><th>${esc(t('jobs.line.description'))}</th><th>${esc(t('jobs.line.kind'))}</th><th class="num">${esc(t('jobs.line.qty'))}</th><th class="num">${esc(t('jobs.line.unit'))}</th><th class="num">${esc(t('jobs.line.total'))}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" class="muted">${esc(t('jobs.lines.empty'))}</td></tr>`}</tbody>
    <tfoot>
      <tr><td colspan="5" class="num">${esc(t('billing.doc.net'))}</td><td class="num">${esc(money(job.netCents))}</td></tr>
      <tr><td colspan="5" class="num">${esc(t('billing.doc.vat', { rate: job.vatRatePercent }))}</td><td class="num">${esc(money(job.vatCents))}</td></tr>
      <tr class="total"><td colspan="5" class="num">${esc(t('billing.doc.total'))}</td><td class="num">${esc(money(job.totalCents))}</td></tr>
    </tfoot>
  </table>
  ${o.message ? `<div class="box">${esc(o.message).replace(/\n/g, '<br>')}</div>` : ''}
  <div class="box small">${esc(t('jobs.quote.terms'))}</div>
  <div class="sign">
    <div><div class="line">${esc(tenant.name)}</div><div class="small muted">${esc(t('print.signature'))}</div></div>
    <div><div class="line">${esc(job.customerName ?? t('print.buildingOwners'))}</div><div class="small muted">${esc(t('jobs.quote.acceptedBy'))}</div></div>
  </div>
  <div class="footer">${esc(t('jobs.quote.footer', { id: job.id.slice(-8) }))}</div>
  ${o.scriptUrl ? `<script src="${esc(o.scriptUrl)}"></script>` : ''}
</body></html>`
}
