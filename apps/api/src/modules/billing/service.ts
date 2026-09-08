import type {
  BillingSummaryDto,
  BuildingBillingDto,
  ContractDto,
  CreatePaymentBody,
  GenerateInvoicesResultDto,
  InvoiceDto,
  InvoiceLineDto,
  InvoiceListQuery,
  Page,
  PayInvoiceBody,
  PaymentDto,
} from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf } from '../../platform/http/ctx.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import {
  addDays,
  fromDateOnly,
  monthBounds,
  toDateOnly,
  todayInSofia,
} from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { transaction } from '../../platform/db/prisma.js'
import { getTenantSettings } from '../tenancy/index.js'
import { buildings, contracts, elevators } from '../registry/index.js'
import * as repo from './repo/billing.js'
import type { InvoiceRow, PaymentRow } from './repo/billing.js'
import { invoiceForPeriod } from './domain/invoice.js'

const iso = (d: Date) => d.toISOString()

export function toInvoiceDto(i: InvoiceRow, today: string = todayInSofia()): InvoiceDto {
  const open = repo.OPEN_STATUSES.includes(i.status) ? i.totalCents - i.paidCents : 0
  const dueAt = toDateOnly(i.dueAt)!
  const overdueDays =
    open > 0 && dueAt < today ? Math.round((Date.parse(today) - Date.parse(dueAt)) / 86_400_000) : 0
  return {
    id: i.id,
    number: i.number,
    contractId: i.contractId,
    buildingId: i.buildingId,
    ...(i.building ? { buildingAddressText: i.building.addressText } : {}),
    customerId: i.customerId,
    period: toDateOnly(i.periodStart)!.slice(0, 7),
    periodStart: toDateOnly(i.periodStart)!,
    periodEnd: toDateOnly(i.periodEnd)!,
    issuedAt: toDateOnly(i.issuedAt)!,
    dueAt,
    amountCents: i.amountCents,
    vatCents: i.vatCents,
    totalCents: i.totalCents,
    paidCents: i.paidCents,
    openCents: open,
    currency: i.currency,
    status: i.status,
    daysOverdue: overdueDays,
    lines: (i.lines as unknown as InvoiceLineDto[]) ?? [],
    paidAt: toDateOnly(i.paidAt),
    createdAt: iso(i.createdAt),
  }
}

export function toPaymentDto(p: PaymentRow): PaymentDto {
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    invoiceNumber: p.invoice?.number ?? null,
    buildingId: p.buildingId,
    ...(p.building ? { buildingAddressText: p.building.addressText } : {}),
    amountCents: p.amountCents,
    paidAt: toDateOnly(p.paidAt)!,
    method: p.method,
    note: p.note,
    createdAt: iso(p.createdAt),
  }
}

/**
 * Status roll: issued -> overdue when dueAt < today. There is no scheduler yet (pg-boss comes with
 * notifications), so every read of billing data rolls first; the write is a single UPDATE and is
 * a no-op most of the time.
 */
export async function rollStatuses(tenantId: string): Promise<number> {
  const rolled = await repo.rollOverdue(tenantId, fromDateOnly(todayInSofia())!)
  for (const inv of rolled) {
    await events.publish(
      { tenantId },
      {
        type: 'InvoiceOverdue',
        aggregateType: 'invoice',
        aggregateId: inv.id,
        payload: {
          number: inv.number,
          buildingId: inv.buildingId,
          dueAt: toDateOnly(inv.dueAt),
          totalCents: inv.totalCents,
        },
      },
    )
  }
  return rolled.length
}

/**
 * One invoice per active contract for the period, from the contract's elevator lines that are in
 * force during that month. Idempotent per (contract, period): existing invoices are skipped and
 * never renumbered. The whole batch is one transaction so numbering stays gapless if it fails.
 */
export async function generate(ctx: Ctx, period: string): Promise<GenerateInvoicesResultDto> {
  const settings = await getTenantSettings(ctx.tenantId)
  const active = await contracts.listActive(ctx.tenantId)
  const customerNames = new Map<string, string>()
  const created = await transaction(async (tx) => {
    const out: InvoiceRow[] = []
    for (const c of active) {
      const draft = invoiceForPeriod(c, period, settings)
      if (!draft) continue
      const existing = await repo.findByContractPeriod(
        ctx.tenantId,
        c.id,
        fromDateOnly(draft.periodStart)!,
        tx,
      )
      if (existing) continue
      const number = await repo.nextInvoiceNumber(ctx.tenantId, tx)
      const row = await repo.createInvoice(
        ctx.tenantId,
        {
          contractId: c.id,
          buildingId: c.buildingId,
          customerId: c.customerId,
          number,
          periodStart: fromDateOnly(draft.periodStart)!,
          periodEnd: fromDateOnly(draft.periodEnd)!,
          issuedAt: fromDateOnly(draft.issuedAt)!,
          dueAt: fromDateOnly(draft.dueAt)!,
          amountCents: draft.amountCents,
          vatCents: draft.vatCents,
          totalCents: draft.totalCents,
          status: 'issued',
          lines: draft.lines,
        },
        tx,
      )
      if (c.customerName) customerNames.set(c.customerId, c.customerName)
      out.push(row)
      await audit(
        actorOf(ctx),
        {
          action: 'invoice.issue',
          entityType: 'invoice',
          entityId: row.id,
          after: { number, period, totalCents: row.totalCents, contractId: c.id },
        },
        tx,
      )
    }
    return out
  })
  for (const row of created) {
    await events.publish(ctx, {
      type: 'InvoiceIssued',
      aggregateType: 'invoice',
      aggregateId: row.id,
      payload: {
        number: row.number,
        period,
        totalCents: row.totalCents,
        buildingId: row.buildingId,
      },
    })
  }
  return {
    period,
    created: created.length,
    skipped: active.length - created.length,
    invoices: created.map((r) => ({
      ...toInvoiceDto(r),
      customerName: customerNames.get(r.customerId),
    })),
  }
}

export async function list(ctx: Ctx, q: InvoiceListQuery): Promise<Page<InvoiceDto>> {
  await rollStatuses(ctx.tenantId)
  const bounds = q.month ? monthBounds(q.month) : null
  const rows = await repo.listInvoices(ctx.tenantId, {
    cursor: q.cursor,
    limit: q.limit,
    status: q.status,
    pending: q.pending,
    buildingId: q.buildingId,
    customerId: q.customerId,
    periodStart: bounds ? fromDateOnly(bounds.start)! : undefined,
    periodEnd: bounds ? fromDateOnly(bounds.end)! : undefined,
  })
  const hasMore = rows.length > q.limit
  const items = hasMore ? rows.slice(0, q.limit) : rows
  const today = todayInSofia()
  return await withCustomerNames(
    ctx,
    items.map((r) => toInvoiceDto(r, today)),
  ).then((dtos) => ({
    items: dtos,
    nextCursor: hasMore ? items[items.length - 1]!.id : null,
  }))
}

export async function get(ctx: Ctx, id: string): Promise<InvoiceDto> {
  await rollStatuses(ctx.tenantId)
  const i = await repo.findInvoice(ctx.tenantId, id)
  if (!i) throw notFound()
  return (await withCustomerNames(ctx, [toInvoiceDto(i)]))[0]!
}

/** "Отбележи като платено": records a payment against the invoice; full amount by default. */
export async function pay(ctx: Ctx, id: string, body: PayInvoiceBody): Promise<InvoiceDto> {
  await rollStatuses(ctx.tenantId)
  const inv = await repo.findInvoice(ctx.tenantId, id)
  if (!inv) throw notFound()
  if (!repo.OPEN_STATUSES.includes(inv.status)) throw new AppError(409, 'billing.invoiceNotOpen')
  const open = inv.totalCents - inv.paidCents
  const amount = body.amountCents ?? open
  if (amount > open) throw new AppError(400, 'billing.paymentExceedsOpen')
  const updated = await transaction(async (tx) => {
    const p = await repo.createPayment(
      ctx.tenantId,
      {
        invoiceId: inv.id,
        buildingId: inv.buildingId,
        amountCents: amount,
        paidAt: fromDateOnly(body.paidAt)!,
        method: body.method,
        note: body.note ?? null,
        createdByUserId: ctx.userId,
      },
      tx,
    )
    const paidCents = inv.paidCents + amount
    const settled = paidCents >= inv.totalCents
    const row = await repo.updateInvoice(
      ctx.tenantId,
      inv.id,
      {
        paidCents,
        ...(settled ? { status: 'paid', paidAt: fromDateOnly(body.paidAt)! } : {}),
      },
      tx,
    )
    await audit(
      actorOf(ctx),
      {
        action: 'invoice.pay',
        entityType: 'invoice',
        entityId: inv.id,
        before: { status: inv.status, paidCents: inv.paidCents },
        after: { status: row.status, paidCents: row.paidCents, paymentId: p.id },
      },
      tx,
    )
    return row
  })
  await events.publish(ctx, {
    type: 'PaymentRecorded',
    aggregateType: 'invoice',
    aggregateId: inv.id,
    payload: {
      amountCents: amount,
      buildingId: inv.buildingId,
      settled: updated.status === 'paid',
    },
  })
  return (await withCustomerNames(ctx, [toInvoiceDto(updated)]))[0]!
}

/** Unallocated (or invoice-linked) payment for a building. */
export async function createPayment(ctx: Ctx, body: CreatePaymentBody): Promise<PaymentDto> {
  if (body.invoiceId) {
    const inv = await get(ctx, body.invoiceId)
    if (inv.buildingId !== body.buildingId)
      throw new AppError(400, 'billing.invoiceBuildingMismatch')
    await pay(ctx, body.invoiceId, {
      paidAt: body.paidAt,
      method: body.method,
      amountCents: body.amountCents,
      note: body.note,
    })
    const rows = await repo.listPayments(ctx.tenantId, { buildingId: body.buildingId, limit: 1 })
    return toPaymentDto(rows[0]!)
  }
  if (!(await buildings.find(ctx.tenantId, body.buildingId))) throw notFound()
  const p = await repo.createPayment(ctx.tenantId, {
    invoiceId: null,
    buildingId: body.buildingId,
    amountCents: body.amountCents,
    paidAt: fromDateOnly(body.paidAt)!,
    method: body.method,
    note: body.note ?? null,
    createdByUserId: ctx.userId,
  })
  await audit(actorOf(ctx), {
    action: 'payment.record',
    entityType: 'payment',
    entityId: p.id,
    after: { buildingId: p.buildingId, amountCents: p.amountCents },
  })
  await events.publish(ctx, {
    type: 'PaymentRecorded',
    aggregateType: 'payment',
    aggregateId: p.id,
    payload: { amountCents: p.amountCents, buildingId: p.buildingId, settled: false },
  })
  return toPaymentDto(p)
}

export async function listPayments(
  ctx: Ctx,
  q: { buildingId?: string; month?: string; limit?: number },
): Promise<PaymentDto[]> {
  const bounds = q.month ? monthBounds(q.month) : null
  const rows = await repo.listPayments(ctx.tenantId, {
    buildingId: q.buildingId,
    from: bounds ? fromDateOnly(bounds.start)! : undefined,
    to: bounds ? fromDateOnly(bounds.end)! : undefined,
    limit: q.limit,
  })
  return rows.map(toPaymentDto)
}

/** Numbers for the payments widget and the dashboard (reporting reuses this). */
export async function summary(tenantId: string, month?: string): Promise<BillingSummaryDto> {
  await rollStatuses(tenantId)
  const m = month ?? todayInSofia().slice(0, 7)
  const bounds = monthBounds(m)
  const [open, paid] = await Promise.all([
    repo.openTotals(tenantId),
    repo.paidInRange(tenantId, fromDateOnly(bounds.start)!, fromDateOnly(bounds.end)!),
  ])
  return {
    month: m,
    pendingCents: open.pendingCents,
    pendingCount: open.pendingCount,
    overdueCents: open.overdueCents,
    overdueCount: open.overdueCount,
    paidThisMonthCents: paid.cents,
    paidThisMonthCount: paid.count,
  }
}

export async function buildingBilling(ctx: Ctx, buildingId: string): Promise<BuildingBillingDto> {
  if (!(await buildings.find(ctx.tenantId, buildingId))) throw notFound()
  return billingFor(ctx, buildingId)
}

/** Payment history for the elevator popup: its building's invoices with the elevator's line. */
export async function elevatorBilling(ctx: Ctx, elevatorId: string): Promise<BuildingBillingDto> {
  const e = await elevators.find(ctx.tenantId, elevatorId)
  if (!e) throw notFound()
  const b = await billingFor(ctx, e.buildingId)
  return {
    ...b,
    elevatorId,
    invoices: b.invoices.map((i) => ({
      ...i,
      elevatorAmountCents: i.lines
        .filter((l) => l.elevatorId === elevatorId)
        .reduce((s, l) => s + l.amountCents, 0),
    })),
  }
}

async function billingFor(ctx: Ctx, buildingId: string): Promise<BuildingBillingDto> {
  await rollStatuses(ctx.tenantId)
  const [invoices, payments, open] = await Promise.all([
    repo.invoicesForBuilding(ctx.tenantId, buildingId),
    repo.listPayments(ctx.tenantId, { buildingId, limit: 60 }),
    repo.openTotals(ctx.tenantId, buildingId),
  ])
  const today = todayInSofia()
  return {
    buildingId,
    invoices: await withCustomerNames(
      ctx,
      invoices.map((i) => toInvoiceDto(i, today)),
    ),
    payments: payments.map(toPaymentDto),
    pendingCents: open.pendingCents,
    overdueCents: open.overdueCents,
  }
}

/** Customer names come from the registry (one query per distinct contract, cached per call). */
async function withCustomerNames(ctx: Ctx, dtos: InvoiceDto[]): Promise<InvoiceDto[]> {
  const ids = [...new Set(dtos.map((d) => d.contractId))]
  const found = await Promise.all(ids.map((id) => contracts.findDto(ctx.tenantId, id)))
  const names = new Map<string, string | undefined>()
  for (const c of found) if (c) names.set(c.id, c.customerName)
  return dtos.map((d) => ({ ...d, customerName: names.get(d.contractId) }))
}

export type { ContractDto }
export { addDays }
