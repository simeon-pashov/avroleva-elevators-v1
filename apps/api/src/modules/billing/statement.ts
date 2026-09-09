import type { BuildingStatementDto, StatementQuery } from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { notFound } from '../../platform/http/errors.js'
import { addDays, toDateOnly, todayInSofia } from '../../platform/clock.js'
import { config } from '../../platform/config.js'
import { getTenant, getTenantSettings } from '../tenancy/index.js'
import { buildings } from '../registry/index.js'
import * as repo from './repo/billing.js'
import { foldStatement } from './domain/statement.js'
import { openCentsOf } from './domain/states.js'
import { bankDetailsOf, epcFor } from './domain/bank.js'
import { rollStatuses } from './service.js'

/** Default window: the last 12 months up to today. */
export function statementWindow(
  q: StatementQuery,
  today = todayInSofia(),
): { from: string; to: string } {
  const to = q.to ?? today
  const from = q.from ?? addDays(to, -365)
  return { from, to }
}

/**
 * Statement per building (ADR 0001): invoices, late fees, credit notes and payments folded into
 * one ledger with a running balance, the open invoices at the end of the window and the EPC QR
 * for their sum with the references as remittance text.
 */
export async function statement(
  ctx: Ctx,
  buildingId: string,
  q: StatementQuery,
): Promise<BuildingStatementDto> {
  await rollStatuses(ctx.tenantId)
  const b = await buildings.find(ctx.tenantId, buildingId)
  if (!b) throw notFound()
  const detail = await buildings.get(ctx, buildingId)
  const { from, to } = statementWindow(q)
  const [tenant, settings, invoices, payments, creditNotes, adjustments] = await Promise.all([
    getTenant(ctx.tenantId),
    getTenantSettings(ctx.tenantId),
    repo.allInvoicesForBuilding(ctx.tenantId, buildingId),
    repo.allPaymentsForBuilding(ctx.tenantId, buildingId),
    repo.creditNotesForBuilding(ctx.tenantId, buildingId),
    repo.adjustmentsForBuilding(ctx.tenantId, buildingId),
  ])
  const t = ctx.t
  const fold = foldStatement(
    {
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        issuedAt: toDateOnly(i.issuedAt)!,
        totalCents: i.totalCents,
        paymentReference: i.paymentReference,
        period: toDateOnly(i.periodStart)!.slice(0, 7),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        paidAt: toDateOnly(p.paidAt)!,
        amountCents: p.amountCents,
        invoiceId: p.invoiceId,
        invoiceNumber: p.invoice?.number ?? null,
        reference: p.reference,
        method: p.method,
      })),
      creditNotes: creditNotes.map((c) => ({
        id: c.id,
        number: c.number,
        issuedAt: toDateOnly(c.issuedAt)!,
        totalCents: c.totalCents,
        invoiceId: c.invoiceId,
        invoiceNumber: c.invoice.number,
      })),
      adjustments: adjustments.map((a) => ({
        id: a.id,
        date: toDateOnly(a.createdAt)!,
        amountCents: a.amountCents,
        invoiceId: a.invoiceId,
        invoiceNumber: a.invoice.number,
        stageKey: a.stageKey,
      })),
    },
    from,
    to,
    {
      invoice: (i) => t('statement.line.invoice', { number: i.number, period: i.period }),
      payment: (p) =>
        p.invoiceNumber != null
          ? t('statement.line.payment', { number: p.invoiceNumber })
          : t('statement.line.unallocated'),
      creditNote: (c) =>
        t('statement.line.creditNote', { number: c.number, invoice: c.invoiceNumber }),
      lateFee: (a) => t('statement.line.lateFee', { number: a.invoiceNumber }),
    },
  )
  const open = invoices
    .filter((i) => openCentsOf(i) > 0 && toDateOnly(i.issuedAt)! <= to)
    .map((i) => ({
      id: i.id,
      number: i.number,
      paymentReference: i.paymentReference,
      openCents: openCentsOf(i),
      period: toDateOnly(i.periodStart)!.slice(0, 7),
      dueAt: toDateOnly(i.dueAt)!,
    }))
  const openTotal = open.reduce((s, i) => s + i.openCents, 0)
  const bank = bankDetailsOf(settings, tenant.name)
  const remittance = open.map((i) => i.paymentReference).join(', ')
  const primary = detail.contacts.find((c) => c.isPrimary) ?? detail.contacts[0] ?? null
  const base = config.BASE_PATH === '/' ? '' : config.BASE_PATH
  return {
    buildingId,
    buildingAddressText: b.addressText,
    customerName: detail.customerName ?? null,
    contactName: primary?.name ?? null,
    contactEmail: detail.contacts.find((c) => c.email)?.email ?? null,
    from,
    to,
    openingBalanceCents: fold.openingBalanceCents,
    lines: fold.lines,
    closingBalanceCents: fold.closingBalanceCents,
    openInvoices: open,
    bank,
    epc: await epcFor(bank, openTotal, remittance || tenant.name),
    printUrl: `${base}/print/statement/${buildingId}?from=${from}&to=${to}`,
  }
}

export interface PublicPaymentBlock {
  bank: NonNullable<BuildingStatementDto['bank']>
  epc: BuildingStatementDto['epc']
  openCents: number
  reference: string
  openCount: number
}

/**
 * The public QR page's payment block: the building's open balance with the tenant's bank details
 * and an EPC QR. Null when the tenant turned it off, has no IBAN, or nothing is open.
 */
export async function publicPayment(
  tenantId: string,
  buildingId: string,
): Promise<PublicPaymentBlock | null> {
  const settings = await getTenantSettings(tenantId)
  if (!settings.billing.showPaymentOnPublicPage) return null
  const tenant = await getTenant(tenantId)
  const bank = bankDetailsOf(settings, tenant.name)
  if (!bank) return null
  await rollStatuses(tenantId)
  const open = (await repo.openInvoices(tenantId, buildingId)).map((i) => ({
    reference: i.paymentReference,
    openCents: openCentsOf(i),
  }))
  const openCents = open.reduce((s, i) => s + i.openCents, 0)
  if (openCents <= 0) return null
  const reference = open.map((i) => i.reference).join(', ')
  return {
    bank,
    epc: await epcFor(bank, openCents, reference),
    openCents,
    reference,
    openCount: open.length,
  }
}
