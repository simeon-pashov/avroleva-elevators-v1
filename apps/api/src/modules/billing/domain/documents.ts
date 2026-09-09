import type {
  BuildingStatementDto,
  InvoiceDetailDto,
  TenantBankDetailsDto,
  TenantDto,
} from '@avroleva/contracts'
import { formatDate, formatMoney } from '@avroleva/i18n'
import type { T } from '@avroleva/i18n'

/**
 * Printable invoice and statement (self-contained HTML like the monthly building report: inline
 * print CSS, Cyrillic-safe font stack, no external assets; the copy button and the print button
 * are wired by /print/assets/print.js, never inline). Operational vocabulary only.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const DOC_CSS = `
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
  .status { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 9.5pt; font-weight: 700; background: #e5e7eb; }
  .status.paid { background: #dcfce7; color: #166534; } .status.overdue { background: #fee2e2; color: #991b1b; }
  .pay { display: flex; gap: 20px; align-items: flex-start; border: 1px solid #d0d5dd; border-radius: 8px; padding: 12px; margin-top: 14px; page-break-inside: avoid; }
  .pay svg { width: 38mm; height: 38mm; flex: none; }
  .iban { font-family: ui-monospace, Consolas, monospace; font-size: 12pt; letter-spacing: .04em; }
  .ref { font-family: ui-monospace, Consolas, monospace; font-weight: 700; }
  .copy { font: inherit; font-size: 9pt; padding: 2px 8px; border: 1px solid #1d4ed8; border-radius: 4px; background: #fff; color: #1d4ed8; cursor: pointer; margin-left: 6px; }
  .footer { margin-top: 22px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 9.5pt; color: #333; }
  .toolbar { position: sticky; top: 0; background: #f3f4f6; border-bottom: 1px solid #ddd; padding: 8px 12px; margin: -24px -24px 16px; display: flex; gap: 8px; }
  .btn { display: inline-block; padding: 6px 12px; border: 1px solid #1d4ed8; border-radius: 6px; background: #2563eb; color: #fff; text-decoration: none; font: inherit; cursor: pointer; }
  .demo { display: inline-block; background: #fef3c7; color: #92400e; border-radius: 4px; padding: 1px 6px; font-size: 9pt; font-weight: 700; margin-left: 6px; }
  @media print { .toolbar, .copy { display: none !important; } body { padding: 0; } @page { size: A4; margin: 14mm; } }
`

export interface DocOptions {
  toolbar?: boolean
  scriptUrl?: string
  lang: string
}

function shell(title: string, body: string, o: DocOptions): string {
  return `<!doctype html>
<html lang="${esc(o.lang)}">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
${body}
${o.scriptUrl ? `<script src="${esc(o.scriptUrl)}" defer></script>` : ''}
</body>
</html>`
}

function head(tenant: TenantDto, right: string): string {
  return `<div class="head">
    <div><div class="firm">${esc(tenant.name)}</div><div class="small muted">${esc(tenant.address)}<br>${esc(tenant.phone)}${tenant.email ? ` · ${esc(tenant.email)}` : ''}<br>ЕИК ${esc(tenant.eik)}${tenant.vatNo ? ` · ${esc(tenant.vatNo)}` : ''}</div></div>
    <div style="text-align:right">${right}</div>
  </div>`
}

/** Bank block: IBAN with copy button, reference with copy button, EPC QR. */
export function payBlock(
  t: T,
  bank: TenantBankDetailsDto | null,
  epc: { svg: string } | null,
  reference: string,
  amountLabel: string,
): string {
  if (!bank) return ''
  return `<div class="pay">
    ${epc ? epc.svg : ''}
    <div>
      <div class="small muted">${esc(t('billing.doc.payBy'))}</div>
      <div><span class="small muted">${esc(t('billing.doc.beneficiary'))}:</span> <strong>${esc(bank.beneficiary)}</strong></div>
      <div><span class="small muted">IBAN:</span> <span class="iban" id="iban">${esc(bank.ibanFormatted)}</span><button type="button" class="copy" data-copy="${esc(bank.iban)}">${esc(t('billing.doc.copy'))}</button></div>
      ${bank.bic ? `<div><span class="small muted">BIC:</span> ${esc(bank.bic)}${bank.bankName ? ` · ${esc(bank.bankName)}` : ''}</div>` : bank.bankName ? `<div>${esc(bank.bankName)}</div>` : ''}
      ${reference ? `<div><span class="small muted">${esc(t('billing.doc.reference'))}:</span> <span class="ref">${esc(reference)}</span><button type="button" class="copy" data-copy="${esc(reference)}">${esc(t('billing.doc.copy'))}</button></div>` : ''}
      ${amountLabel ? `<div><span class="small muted">${esc(t('billing.doc.amount'))}:</span> <strong>${esc(amountLabel)}</strong></div>` : ''}
      ${epc ? `<div class="small muted">${esc(t('billing.doc.qrHint'))}</div>` : ''}
    </div>
  </div>`
}

export function renderInvoiceHtml(
  inv: InvoiceDetailDto,
  tenant: TenantDto,
  t: T,
  o: DocOptions,
): string {
  const locale = o.lang
  const money = (c: number) => formatMoney(c, locale)
  const d = (v: string | null | undefined) => (v ? formatDate(v, locale) : '—')
  const lines = inv.lines
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="num">${esc(money(l.amountCents))}</td></tr>`,
    )
    .join('')
  const extras = [
    ...inv.adjustments.map(
      (a) =>
        `<tr><td>${esc(d(a.createdAt))}</td><td>${esc(t('billing.doc.lateFee'))}${a.stageKey ? ` · ${esc(a.stageKey)}` : ''}</td><td class="num">${esc(money(a.amountCents))}</td></tr>`,
    ),
    ...inv.creditNotes.map(
      (c) =>
        `<tr><td>${esc(d(c.issuedAt))}</td><td>${esc(t('billing.doc.creditNote', { number: c.number }))} · ${esc(c.reason)}</td><td class="num">−${esc(money(c.totalCents))}</td></tr>`,
    ),
    ...inv.payments.map(
      (p) =>
        `<tr><td>${esc(d(p.paidAt))}</td><td>${esc(t('billing.doc.payment'))} · ${esc(t(`enum.paymentMethod.${p.method}`))}${p.provider === 'demo' ? ` <span class="demo">DEMO</span>` : ''}</td><td class="num">−${esc(money(p.amountCents))}</td></tr>`,
    ),
  ].join('')
  const statusClass = inv.status === 'paid' ? 'paid' : inv.status === 'overdue' ? 'overdue' : ''
  const body = `
  ${o.toolbar ? `<div class="toolbar"><button type="button" class="btn" data-print>${esc(t('print.print'))}</button></div>` : ''}
  ${head(
    tenant,
    `<h1>${esc(t('billing.doc.invoiceTitle'))} № ${esc(String(inv.number).padStart(10, '0'))}</h1>
     <div class="small">${esc(t('billing.doc.issuedAt'))}: ${esc(d(inv.issuedAt))} · ${esc(t('billing.doc.dueAt'))}: ${esc(d(inv.dueAt))}</div>
     <div><span class="status ${statusClass}">${esc(t(`enum.invoiceStatus.${inv.status}`))}</span></div>`,
  )}
  <div class="parties">
    <div><div class="label">${esc(t('billing.doc.recipient'))}</div><strong>${esc(inv.customerName ?? '')}</strong><div>${esc(inv.buildingAddressText ?? '')}</div></div>
    <div><div class="label">${esc(t('billing.doc.period'))}</div><strong>${esc(inv.periodStart)} – ${esc(inv.periodEnd)}</strong><div class="small muted">${esc(t('billing.doc.reference'))}: <span class="ref">${esc(inv.paymentReference)}</span></div></div>
  </div>
  <table>
    <thead><tr><th>№</th><th>${esc(t('billing.doc.description'))}</th><th class="num">${esc(t('billing.doc.amount'))}</th></tr></thead>
    <tbody>${lines}
      <tr><td colspan="2" class="num">${esc(t('billing.doc.net'))}</td><td class="num">${esc(money(inv.amountCents))}</td></tr>
      <tr><td colspan="2" class="num">${esc(t('billing.doc.vat'))}</td><td class="num">${esc(money(inv.vatCents))}</td></tr>
      <tr class="total"><td colspan="2" class="num">${esc(t('billing.doc.total'))}</td><td class="num">${esc(money(inv.totalCents))}</td></tr>
    </tbody>
  </table>
  ${
    extras
      ? `<h2>${esc(t('billing.doc.movements'))}</h2><table><thead><tr><th>${esc(t('print.date'))}</th><th>${esc(t('billing.doc.description'))}</th><th class="num">${esc(t('billing.doc.amount'))}</th></tr></thead><tbody>${extras}
      <tr class="total"><td colspan="2" class="num">${esc(t('billing.doc.open'))}</td><td class="num">${esc(money(inv.openCents))}</td></tr></tbody></table>`
      : ''
  }
  ${inv.openCents > 0 ? payBlock(t, inv.bank, inv.epc, inv.paymentReference, money(inv.openCents)) : ''}
  <div class="footer">${esc(t('billing.doc.footer', { firm: tenant.name }))}</div>`
  return shell(`${t('billing.doc.invoiceTitle')} ${inv.number}`, body, o)
}

export function renderStatementHtml(
  s: BuildingStatementDto,
  tenant: TenantDto,
  t: T,
  o: DocOptions,
): string {
  const locale = o.lang
  const money = (c: number) => formatMoney(c, locale)
  const d = (v: string) => formatDate(v, locale)
  const rows = s.lines
    .map(
      (l) =>
        `<tr><td>${esc(d(l.date))}</td><td>${esc(t(`statement.kind.${l.kind}`))}</td><td>${esc(l.ref)}</td><td>${esc(l.description)}</td><td class="num">${l.debitCents ? esc(money(l.debitCents)) : ''}</td><td class="num">${l.creditCents ? esc(money(l.creditCents)) : ''}</td><td class="num">${esc(money(l.balanceCents))}</td></tr>`,
    )
    .join('')
  const openTotal = s.openInvoices.reduce((a, i) => a + i.openCents, 0)
  const body = `
  ${o.toolbar ? `<div class="toolbar"><button type="button" class="btn" data-print>${esc(t('print.print'))}</button></div>` : ''}
  ${head(
    tenant,
    `<h1>${esc(t('statement.title'))}</h1><div class="small">${esc(d(s.from))} – ${esc(d(s.to))}</div>`,
  )}
  <div class="parties">
    <div><div class="label">${esc(t('billing.doc.recipient'))}</div><strong>${esc(s.customerName ?? '')}</strong><div>${esc(s.buildingAddressText)}</div>${s.contactName ? `<div class="small muted">${esc(s.contactName)}</div>` : ''}</div>
    <div><div class="label">${esc(t('statement.closing'))}</div><strong style="font-size:14pt">${esc(money(s.closingBalanceCents))}</strong><div class="small muted">${esc(t('statement.opening'))}: ${esc(money(s.openingBalanceCents))}</div></div>
  </div>
  <table>
    <thead><tr><th>${esc(t('print.date'))}</th><th>${esc(t('statement.col.kind'))}</th><th>№</th><th>${esc(t('billing.doc.description'))}</th><th class="num">${esc(t('statement.col.debit'))}</th><th class="num">${esc(t('statement.col.credit'))}</th><th class="num">${esc(t('statement.col.balance'))}</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="muted">${esc(t('statement.empty'))}</td></tr>`}</tbody>
  </table>
  ${
    s.openInvoices.length
      ? `<h2>${esc(t('statement.openInvoices'))}</h2><table><thead><tr><th>№</th><th>${esc(t('billing.doc.reference'))}</th><th class="num">${esc(t('billing.doc.open'))}</th></tr></thead><tbody>${s.openInvoices
          .map(
            (i) =>
              `<tr><td>${i.number}</td><td class="ref">${esc(i.paymentReference)}</td><td class="num">${esc(money(i.openCents))}</td></tr>`,
          )
          .join(
            '',
          )}<tr class="total"><td colspan="2" class="num">${esc(t('billing.doc.total'))}</td><td class="num">${esc(money(openTotal))}</td></tr></tbody></table>`
      : ''
  }
  ${payBlock(t, s.bank, openTotal > 0 ? s.epc : null, openTotal > 0 ? (s.epc?.reference ?? '') : '', openTotal > 0 ? money(openTotal) : '')}
  <div class="footer">${esc(t('billing.doc.footer', { firm: tenant.name }))}</div>`
  return shell(`${t('statement.title')} · ${s.buildingAddressText}`, body, o)
}
