import type { BuildingReportDto } from '@avroleva/contracts'
import { formatDate, formatDateTime, formatMoney } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'

/**
 * Printable monthly building report: self-contained HTML (inline print CSS, Cyrillic-safe font
 * stack, no scripts, no external assets) so the same string serves the /print page and the
 * e-mail attachment. Operational vocabulary only.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font-family: "Segoe UI", Roboto, "Noto Sans", "DejaVu Sans", Arial, sans-serif; color: #111; background: #fff; font-size: 11pt; line-height: 1.4; }
  h1 { font-size: 18pt; margin: 0 0 4px; } h2 { font-size: 13pt; margin: 22px 0 6px; border-bottom: 2px solid #1d4ed8; padding-bottom: 3px; }
  h3 { font-size: 11pt; margin: 12px 0 4px; }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 12px; }
  .firm { font-weight: 700; font-size: 13pt; } .muted { color: #555; } .small { font-size: 9.5pt; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; font-size: 10pt; }
  th, td { border: 1px solid #d0d5dd; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  .kpis { display: flex; gap: 14px; flex-wrap: wrap; margin: 10px 0; }
  .kpi { border: 1px solid #d0d5dd; border-radius: 6px; padding: 8px 12px; min-width: 130px; }
  .kpi b { display: block; font-size: 16pt; }
  .defect { color: #b91c1c; font-weight: 600; } .ok { color: #15803d; }
  .footer { margin-top: 26px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 9.5pt; color: #333; }
  .toolbar { position: sticky; top: 0; background: #f3f4f6; border-bottom: 1px solid #ddd; padding: 8px 12px; margin: -24px -24px 16px; display: flex; gap: 8px; }
  .btn { display: inline-block; padding: 6px 12px; border: 1px solid #1d4ed8; border-radius: 6px; background: #2563eb; color: #fff; text-decoration: none; font: inherit; cursor: pointer; }
  @media print { .toolbar { display: none !important; } body { padding: 0; } @page { size: A4; margin: 14mm; } }
`

export function monthLabel(period: string, locale: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number]
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)))
}

export function renderBuildingReportHtml(
  r: BuildingReportDto,
  t: T,
  locale: string,
  opts: { toolbar?: boolean; scriptUrl?: string } = {},
): string {
  const d = (v: string | null | undefined) => (v ? formatDate(v, locale) : '—')
  const dt = (v: string | null | undefined) => (v ? formatDateTime(v, locale) : '—')
  const money = (c: number) => formatMoney(c, locale)
  const label = monthLabel(r.period, locale)

  const elevators = r.elevators
    .map((e) => {
      const visits = e.visits.length
        ? `<table><thead><tr><th>${esc(t('report.date'))}</th><th>${esc(t('report.kind'))}</th><th>${esc(t('report.technicians'))}</th><th>${esc(t('report.checklist'))}</th><th>${esc(t('report.defectsFound'))}</th></tr></thead><tbody>${e.visits
            .map(
              (v) =>
                `<tr><td>${esc(dt(v.startedAt))}</td><td>${esc(t(`enum.visitKind.${v.kind}`))}</td><td>${esc(v.technicians.join(', ') || '—')}</td><td>${
                  v.checklistSummary
                    ? `<span class="ok">${v.checklistSummary.ok} ${esc(t('report.ok'))}</span>${v.checklistSummary.defect ? `, <span class="defect">${v.checklistSummary.defect} ${esc(t('report.defect'))}</span>` : ''}`
                    : '—'
                }</td><td>${v.defectsFound.length ? `<span class="defect">${esc(v.defectsFound.join('; '))}</span>` : '—'}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : `<p class="muted small">${esc(t('report.noVisits'))}</p>`
      const callbacks = e.callbacks.length
        ? `<table><thead><tr><th>${esc(t('report.received'))}</th><th>${esc(t('report.classification'))}</th><th>${esc(t('report.response'))}</th><th>${esc(t('report.cause'))}</th><th>${esc(t('report.status'))}</th></tr></thead><tbody>${e.callbacks
            .map(
              (c) =>
                `<tr><td>${esc(dt(c.receivedAt))}</td><td>${esc(t(`enum.callbackClassification.${c.classification}`))}</td><td>${c.responseMinutes == null ? '—' : esc(t('report.minutes', { count: c.responseMinutes }))}</td><td>${esc(c.cause ?? '—')}</td><td>${esc(t(`enum.callbackStatus.${c.status}`))}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : `<p class="muted small">${esc(t('report.noCallbacks'))}</p>`
      const defects = e.openDefects.length
        ? `<ul>${e.openDefects.map((x) => `<li class="${x.stopLift ? 'defect' : ''}">${esc(x.description)} <span class="muted small">(${esc(d(x.recordedAt))})</span></li>`).join('')}</ul>`
        : `<p class="muted small">${esc(t('report.noOpenDefects'))}</p>`
      return `<section>
  <h2>${esc(t('report.elevator'))} ${esc(e.internalNo)}${e.regNo ? ` <span class="muted small">${esc(t('elevators.regNo'))} ${esc(e.regNo)}</span>` : ''}</h2>
  <p class="small">${esc(t('report.status'))}: ${esc(t(`enum.elevatorStatus.${e.status}`))} · ${esc(t('report.nextCheck'))}: ${esc(d(e.nextCheckDueAt))} · ${esc(t('report.nextInspection'))}: ${esc(d(e.nextInspectionAt))}</p>
  <h3>${esc(t('report.visits'))}</h3>${visits}
  <h3>${esc(t('report.callbacks'))}</h3>${callbacks}
  <h3>${esc(t('report.openDefects'))}</h3>${defects}
</section>`
    })
    .join('')

  const invoices = r.billing.invoices.length
    ? `<table><thead><tr><th>№</th><th>${esc(t('report.period'))}</th><th>${esc(t('report.amount'))}</th><th>${esc(t('report.paid'))}</th><th>${esc(t('report.due'))}</th><th>${esc(t('report.status'))}</th></tr></thead><tbody>${r.billing.invoices
        .map(
          (i) =>
            `<tr><td>${i.number}</td><td>${esc(i.period)}</td><td>${esc(money(i.totalCents))}</td><td>${esc(money(i.paidCents))}</td><td>${esc(d(i.dueAt))}</td><td>${esc(t(`enum.invoiceStatus.${i.status}`))}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : `<p class="muted small">${esc(t('report.noInvoices'))}</p>`

  const toolbar = opts.toolbar
    ? `<div class="toolbar"><button type="button" class="btn" data-print>${esc(t('print.print'))}</button></div>`
    : ''

  return `<!doctype html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t('report.title', { month: label }))} – ${esc(r.building.addressText)}</title>
<style>${CSS}</style>
</head>
<body>
${toolbar}
<div class="head">
  <div><div class="firm">${esc(r.tenant.name)}</div><div class="small">${esc(r.tenant.address)}</div></div>
  <div class="small" style="text-align:right">${esc(r.tenant.phone)}${r.tenant.email ? `<br>${esc(r.tenant.email)}` : ''}</div>
</div>
<h1>${esc(t('report.title', { month: label }))}</h1>
<p><b>${esc(r.building.addressText)}</b>${r.building.customerName ? ` · ${esc(r.building.customerName)}` : ''}${r.building.contactName ? `<br><span class="small">${esc(t('report.contact'))}: ${esc(r.building.contactName)}</span>` : ''}</p>
<div class="kpis">
  <div class="kpi"><b>${r.totals.visits}</b>${esc(t('report.visits'))}</div>
  <div class="kpi"><b>${r.totals.callbacks}</b>${esc(t('report.callbacks'))}</div>
  <div class="kpi"><b>${r.totals.avgResponseMinutes == null ? '—' : r.totals.avgResponseMinutes}</b>${esc(t('report.avgResponse'))}</div>
  <div class="kpi"><b>${r.totals.openDefects}</b>${esc(t('report.openDefects'))}</div>
</div>
${elevators}
<h2>${esc(t('report.billing'))}</h2>
${invoices}
${r.billing.outstandingCents > 0 ? `<p><b>${esc(t('report.outstanding'))}: ${esc(money(r.billing.outstandingCents))}</b></p>` : ''}
<div class="footer">${esc(t('report.footer', { phone: r.tenant.emergencyPhone }))} · ${esc(r.tenant.name)}, ${esc(r.tenant.phone)} · ${esc(t('report.generatedAt'))} ${esc(dt(r.generatedAt))}</div>
${opts.scriptUrl ? `<script src="${esc(opts.scriptUrl)}" defer></script>` : ''}
</body>
</html>`
}
