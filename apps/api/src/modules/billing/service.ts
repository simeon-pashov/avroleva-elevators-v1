import type {
  BillingSummaryDto,
  BuildingBillingDto,
  BulkInvoiceBody,
  BulkInvoiceResultDto,
  ContractDto,
  CreateCreditNoteBody,
  CreatePaymentBody,
  CreditNoteDto,
  GenerateInvoicesResultDto,
  InvoiceAdjustmentDto,
  InvoiceDetailDto,
  InvoiceDto,
  InvoiceLineDto,
  InvoiceListQuery,
  JobInvoiceRefDto,
  Page,
  PayInvoiceBody,
  PaymentDto,
  PaymentLinkDto,
  PaymentProviderName,
  TenantSettings,
} from '@avroleva/contracts'
import type { Ctx } from '../../platform/http/ctx.js'
import { actorOf, systemActorOf } from '../../platform/http/ctx.js'
import type { AuditActor } from '../../platform/audit.js'
import { AppError, notFound } from '../../platform/http/errors.js'
import { audit } from '../../platform/audit.js'
import {
  addDays,
  clock,
  fromDateOnly,
  monthBounds,
  toDateOnly,
  todayInSofia,
} from '../../platform/clock.js'
import { events } from '../../platform/events/bus.js'
import { transaction } from '../../platform/db/prisma.js'
import type { Tx } from '../../platform/db/prisma.js'
import { paymentProvider } from '../../platform/adapters/payments/index.js'
import { getTenant, getTenantFeatures, getTenantSettings } from '../tenancy/index.js'
import { buildings, contracts, customers, elevators } from '../registry/index.js'
import * as repo from './repo/billing.js'
import type {
  AdjustmentRow,
  CreditNoteRow,
  InvoiceDetailRow,
  InvoiceRow,
  PaymentRow,
} from './repo/billing.js'
import type { LinkRow } from './repo/imports.js'
import { invoiceForPeriod } from './domain/invoice.js'
import { cycleOf, effectiveRunDay, periodMonths, periodStartsCycle } from './domain/cycle.js'
import { paymentReferenceFor } from './domain/reference.js'
import { isOpenStatus, openCentsOf, statusAfterBalanceChange } from './domain/states.js'
import { bankDetailsOf, epcFor } from './domain/bank.js'

const iso = (d: Date) => d.toISOString()

export function toInvoiceDto(i: InvoiceRow, today: string = todayInSofia()): InvoiceDto {
  const open = openCentsOf(i)
  const dueAt = toDateOnly(i.dueAt)!
  const overdueDays =
    open > 0 && dueAt < today ? Math.round((Date.parse(today) - Date.parse(dueAt)) / 86_400_000) : 0
  return {
    id: i.id,
    number: i.number,
    paymentReference: i.paymentReference,
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
    lateFeeCents: i.lateFeeCents,
    creditedCents: i.creditedCents,
    openCents: open,
    currency: i.currency,
    status: i.status,
    daysOverdue: overdueDays,
    dunningStage: i.dunningStage,
    dunningStageKey: i.dunningStageKey,
    dunningAt: i.dunningAt ? iso(i.dunningAt) : null,
    sourceType: i.sourceType,
    sourceId: i.sourceId,
    jobId: i.sourceType === 'job' ? i.sourceId : null,
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
    reference: p.reference,
    source: p.source,
    provider: p.provider,
    providerRef: p.providerRef,
    counterparty: p.counterparty,
    createdAt: iso(p.createdAt),
  }
}

export function toCreditNoteDto(c: CreditNoteRow): CreditNoteDto {
  return {
    id: c.id,
    invoiceId: c.invoiceId,
    invoiceNumber: c.invoice?.number,
    number: c.number,
    issuedAt: toDateOnly(c.issuedAt)!,
    amountCents: c.amountCents,
    vatCents: c.vatCents,
    totalCents: c.totalCents,
    reason: c.reason,
    createdAt: iso(c.createdAt),
  }
}

export function toAdjustmentDto(a: AdjustmentRow): InvoiceAdjustmentDto {
  return {
    id: a.id,
    invoiceId: a.invoiceId,
    kind: 'late_fee',
    amountCents: a.amountCents,
    reason: a.reason,
    stageKey: a.stageKey,
    createdAt: iso(a.createdAt),
  }
}

export function toLinkDto(l: LinkRow): PaymentLinkDto {
  return {
    id: l.id,
    invoiceId: l.invoiceId,
    provider: l.provider,
    url: l.url,
    amountCents: l.amountCents,
    status: l.status,
    createdAt: iso(l.createdAt),
    expiresAt: iso(l.expiresAt),
    paidAt: l.paidAt ? iso(l.paidAt) : null,
  }
}

/** Effective billing settings: ADR 0001 `billing.dueDays` wins, `invoiceDueDays` is the fallback. */
export function effectiveBilling(settings: TenantSettings) {
  return {
    invoiceDueDays: settings.billing.dueDays ?? settings.invoiceDueDays,
    vatRatePercent: settings.vatRatePercent,
    runDay: settings.billing.runDay,
    runEnabled: settings.billing.runEnabled,
    paymentProvider: settings.billing.paymentProvider,
    showPaymentOnPublicPage: settings.billing.showPaymentOnPublicPage,
  }
}

/**
 * Status roll: issued / partially paid -> overdue when dueAt < today. Runs from the daily job and
 * before every billing read (one atomic UPDATE, a no-op most of the time); emits InvoiceOverdue
 * once per invoice.
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

export interface GenerateOptions {
  /**
   * The scheduled run passes today: contracts whose run day (anchorDay or the tenant's runDay)
   * is later in the month wait for their day. Manual "run now for month X" generates everything.
   */
  asOf?: string
  actor?: AuditActor
}

/**
 * One invoice per active contract for the period, from the contract's elevator lines that are in
 * force. Idempotent per (contract, period start): existing invoices are skipped and never
 * renumbered. Quarterly / yearly contracts only yield an invoice in the first month of their
 * cycle (a 3- / 12-month period); exempt contracts never do. The whole batch is one transaction
 * so numbering stays gapless if it fails; every invoice gets its payer reference at birth.
 */
export async function generate(
  ctx: Ctx,
  period: string,
  opts: GenerateOptions = {},
): Promise<GenerateInvoicesResultDto> {
  const [settings, tenant] = await Promise.all([
    getTenantSettings(ctx.tenantId),
    getTenant(ctx.tenantId),
  ])
  const eff = effectiveBilling(settings)
  const active = await contracts.listActive(ctx.tenantId)
  const customerNames = new Map<string, string>()
  const actor = opts.actor ?? actorOf(ctx)
  const dayOfMonth =
    opts.asOf && opts.asOf.slice(0, 7) === period ? Number(opts.asOf.slice(8, 10)) : null
  const created = await transaction(async (tx) => {
    const out: InvoiceRow[] = []
    for (const c of active) {
      const cycle = cycleOf(c)
      if (cycle.exempt) continue
      if (!periodStartsCycle(c.startDate, period, cycle.cycle)) continue
      if (dayOfMonth != null && effectiveRunDay(cycle, eff.runDay) > dayOfMonth) continue
      const draft = invoiceForPeriod(
        c,
        period,
        { invoiceDueDays: eff.invoiceDueDays, vatRatePercent: eff.vatRatePercent },
        periodMonths(cycle.cycle),
      )
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
          paymentReference: paymentReferenceFor(tenant.eik, number),
          periodStart: fromDateOnly(draft.periodStart)!,
          periodEnd: fromDateOnly(draft.periodEnd)!,
          issuedAt: fromDateOnly(draft.issuedAt)!,
          dueAt: fromDateOnly(draft.dueAt)!,
          amountCents: draft.amountCents,
          vatCents: draft.vatCents,
          totalCents: draft.totalCents,
          status: 'issued',
          lines: draft.lines,
          sourceType: 'contract',
          sourceId: c.id,
        },
        tx,
      )
      if (c.customerName) customerNames.set(c.customerId, c.customerName)
      out.push(row)
      await audit(
        actor,
        {
          action: 'invoice.issue',
          entityType: 'invoice',
          entityId: row.id,
          after: {
            number,
            paymentReference: row.paymentReference,
            period,
            totalCents: row.totalCents,
            contractId: c.id,
          },
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
        paymentReference: row.paymentReference,
        period,
        totalCents: row.totalCents,
        dueAt: toDateOnly(row.dueAt),
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

export interface IssueInvoiceInput {
  /** Where the invoice comes from when not a contract: `job` (step 8). */
  sourceType: 'job'
  sourceId: string
  buildingId: string
  customerId: string
  lines: InvoiceLineDto[]
  /** YYYY-MM-DD; default today (Sofia). */
  issuedAt?: string
  /** YYYY-MM-DD; default issuedAt + the tenant's due days. */
  dueAt?: string
  actor?: AuditActor
}

/**
 * One invoice from explicit lines (HANDOFF-STEP7 section 8): the entry point for repair jobs.
 * Numbering and the payer reference are taken in the same transaction as the row (gapless), the
 * VAT is rounded once per invoice like the contract run, `contractId` stays NULL and
 * `(sourceType, sourceId)` say where the invoice came from. Emits InvoiceIssued; payments,
 * dunning, statements and links then work unchanged. Nothing outside billing touches numbering.
 */
export async function issueInvoice(ctx: Ctx, input: IssueInvoiceInput): Promise<InvoiceDto> {
  const [settings, tenant] = await Promise.all([
    getTenantSettings(ctx.tenantId),
    getTenant(ctx.tenantId),
  ])
  const eff = effectiveBilling(settings)
  const lines = input.lines.filter((l) => l.amountCents !== 0)
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0)
  if (lines.length === 0 || amountCents <= 0) throw new AppError(400, 'billing.emptyInvoice')
  if (!(await buildings.find(ctx.tenantId, input.buildingId))) throw notFound()
  const vatCents = Math.round((amountCents * eff.vatRatePercent) / 100)
  const issuedAt = input.issuedAt ?? todayInSofia()
  const dueAt = input.dueAt ?? addDays(issuedAt, eff.invoiceDueDays)
  const actor = input.actor ?? (ctx.userId ? actorOf(ctx) : systemActorOf(ctx.tenantId))
  const row = await transaction(async (tx) => {
    const number = await repo.nextInvoiceNumber(ctx.tenantId, tx)
    const created = await repo.createInvoice(
      ctx.tenantId,
      {
        contractId: null,
        buildingId: input.buildingId,
        customerId: input.customerId,
        number,
        paymentReference: paymentReferenceFor(tenant.eik, number),
        periodStart: fromDateOnly(issuedAt)!,
        periodEnd: fromDateOnly(issuedAt)!,
        issuedAt: fromDateOnly(issuedAt)!,
        dueAt: fromDateOnly(dueAt)!,
        amountCents,
        vatCents,
        totalCents: amountCents + vatCents,
        status: 'issued',
        lines,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
      tx,
    )
    await audit(
      actor,
      {
        action: 'invoice.issue',
        entityType: 'invoice',
        entityId: created.id,
        after: {
          number,
          paymentReference: created.paymentReference,
          totalCents: created.totalCents,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      tx,
    )
    return created
  })
  await events.publish(ctx, {
    type: 'InvoiceIssued',
    aggregateType: 'invoice',
    aggregateId: row.id,
    payload: {
      number: row.number,
      paymentReference: row.paymentReference,
      period: issuedAt.slice(0, 7),
      totalCents: row.totalCents,
      dueAt: toDateOnly(row.dueAt),
      buildingId: row.buildingId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    },
  })
  return toInvoiceDto(row)
}

/** Invoices created from a job (the jobs module reads them through its InvoiceIssuer port). */
export async function listForSource(
  ctx: Ctx,
  sourceType: 'job',
  sourceId: string,
): Promise<JobInvoiceRefDto[]> {
  await rollStatuses(ctx.tenantId)
  return (await repo.listBySource(ctx.tenantId, sourceType, sourceId)).map((i) => {
    const d = toInvoiceDto(i)
    return {
      id: d.id,
      number: d.number,
      totalCents: d.totalCents,
      openCents: d.openCents,
      status: d.status,
      issuedAt: d.issuedAt,
    }
  })
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
    q: q.q,
    dunningStage: q.dunningStage,
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

/** Provider the tenant selected, downgraded to "none" when it cannot be used right now. */
export function providerStateFor(
  settings: TenantSettings,
  features: { demoMode: boolean },
): { name: PaymentProviderName; enabled: boolean; note: string | null } {
  const name = settings.billing.paymentProvider
  if (name === 'demo' && !features.demoMode)
    return { name, enabled: false, note: 'billing.provider.demoModeOff' }
  const caps = paymentProvider(name).capabilities()
  return { name, enabled: caps.enabled, note: caps.note }
}

/** Invoice + payments, credit notes, late fees, links, the tenant's bank block and the EPC QR. */
export async function detail(ctx: Ctx, id: string): Promise<InvoiceDetailDto> {
  await rollStatuses(ctx.tenantId)
  const row: InvoiceDetailRow | null = await repo.findInvoiceDetail(ctx.tenantId, id)
  if (!row) throw notFound()
  const [tenant, settings, features] = await Promise.all([
    getTenant(ctx.tenantId),
    getTenantSettings(ctx.tenantId),
    getTenantFeatures(ctx.tenantId),
  ])
  const dto = (await withCustomerNames(ctx, [toInvoiceDto(row)]))[0]!
  const bank = bankDetailsOf(settings, tenant.name)
  const number = { number: row.number }
  return {
    ...dto,
    payments: row.payments.map((p) =>
      toPaymentDto({ ...p, building: row.building, invoice: number } as PaymentRow),
    ),
    creditNotes: row.creditNotes.map((c) => toCreditNoteDto({ ...c, invoice: number })),
    adjustments: row.adjustments.map(toAdjustmentDto),
    paymentLinks: row.paymentLinks.map(toLinkDto),
    bank,
    epc: await epcFor(bank, dto.openCents, dto.paymentReference),
    paymentProvider: providerStateFor(settings, features),
  }
}

export interface RecordPaymentInput {
  invoiceId: string | null
  buildingId: string
  amountCents: number
  paidAt: string
  method: PaymentDto['method']
  note?: string | null
  reference?: string | null
  source?: PaymentDto['source']
  provider?: string | null
  providerRef?: string | null
  counterparty?: string | null
  bankImportRowId?: string | null
}

export interface RecordPaymentResult {
  payment: PaymentRow
  invoice: InvoiceRow | null
  /** The part above the open balance, booked as an unallocated payment of the building. */
  remainder: PaymentRow | null
}

/**
 * The one place a payment is written (manual "mark as paid", unallocated building payments, the
 * bank import and the payment providers all end here). Against an invoice: the open balance is
 * settled first, anything above it becomes an unallocated payment for the same building
 * (over-payment, ADR 0001); a smaller amount leaves the invoice partially paid. Status follows
 * the balance; the invoice row itself is never edited beyond paidCents/status/paidAt.
 */
export async function recordPayment(
  ctx: Ctx,
  input: RecordPaymentInput,
  actor: AuditActor = actorOf(ctx),
): Promise<RecordPaymentResult> {
  await rollStatuses(ctx.tenantId)
  const today = todayInSofia()
  const paidAt = fromDateOnly(input.paidAt)!
  const base = {
    method: input.method,
    note: input.note ?? null,
    reference: input.reference ?? null,
    source: input.source ?? 'manual',
    provider: input.provider ?? null,
    providerRef: input.providerRef ?? null,
    counterparty: input.counterparty ?? null,
    bankImportRowId: input.bankImportRowId ?? null,
    createdByUserId: ctx.userId || null,
  }
  if (!input.invoiceId) {
    if (!(await buildings.find(ctx.tenantId, input.buildingId))) throw notFound()
    const p = await repo.createPayment(ctx.tenantId, {
      ...base,
      invoiceId: null,
      buildingId: input.buildingId,
      amountCents: input.amountCents,
      paidAt,
    })
    await audit(actor, {
      action: 'payment.record',
      entityType: 'payment',
      entityId: p.id,
      after: { buildingId: p.buildingId, amountCents: p.amountCents, source: p.source },
    })
    await publishPaymentEvents(ctx, p, null)
    return { payment: p, invoice: null, remainder: null }
  }
  const inv = await repo.findInvoice(ctx.tenantId, input.invoiceId)
  if (!inv) throw notFound()
  if (!isOpenStatus(inv.status)) throw new AppError(409, 'billing.invoiceNotOpen')
  if (inv.buildingId !== input.buildingId)
    throw new AppError(400, 'billing.invoiceBuildingMismatch')
  const open = openCentsOf(inv)
  const allocated = Math.min(input.amountCents, open)
  const rest = input.amountCents - allocated
  const result = await transaction(async (tx) => {
    const p = await repo.createPayment(
      ctx.tenantId,
      { ...base, invoiceId: inv.id, buildingId: inv.buildingId, amountCents: allocated, paidAt },
      tx,
    )
    const paidCents = inv.paidCents + allocated
    const next = { ...inv, paidCents, dueAt: toDateOnly(inv.dueAt)! }
    const status = statusAfterBalanceChange(next, today)
    const row = await repo.updateInvoice(
      ctx.tenantId,
      inv.id,
      { paidCents, status, ...(status === 'paid' ? { paidAt } : {}) },
      tx,
    )
    let remainder: PaymentRow | null = null
    if (rest > 0) {
      remainder = await repo.createPayment(
        ctx.tenantId,
        {
          ...base,
          note: [base.note, `overpayment of ${inv.number}`].filter(Boolean).join(' · '),
          invoiceId: null,
          buildingId: inv.buildingId,
          amountCents: rest,
          paidAt,
        },
        tx,
      )
    }
    await audit(
      actor,
      {
        action: 'invoice.pay',
        entityType: 'invoice',
        entityId: inv.id,
        before: { status: inv.status, paidCents: inv.paidCents },
        after: {
          status: row.status,
          paidCents: row.paidCents,
          paymentId: p.id,
          source: p.source,
          remainderCents: rest,
        },
      },
      tx,
    )
    return { payment: p, invoice: row, remainder }
  })
  await publishPaymentEvents(ctx, result.payment, result.invoice)
  if (result.remainder) await publishPaymentEvents(ctx, result.remainder, null)
  return result
}

async function publishPaymentEvents(ctx: Ctx, p: PaymentRow, inv: InvoiceRow | null) {
  await events.publish(ctx, {
    type: 'PaymentRecorded',
    aggregateType: inv ? 'invoice' : 'payment',
    aggregateId: inv ? inv.id : p.id,
    payload: {
      paymentId: p.id,
      amountCents: p.amountCents,
      buildingId: p.buildingId,
      settled: inv?.status === 'paid',
      source: p.source,
    },
  })
  if (p.source !== 'manual') {
    await events.publish(ctx, {
      type: 'PaymentMatched',
      aggregateType: 'payment',
      aggregateId: p.id,
      payload: {
        paymentId: p.id,
        invoiceId: inv?.id ?? null,
        number: inv?.number ?? null,
        amountCents: p.amountCents,
        buildingId: p.buildingId,
        source: p.source,
        provider: p.provider,
        reference: p.reference,
        settled: inv?.status === 'paid',
      },
    })
  }
}

/** "Отбележи като платено": records a payment against the invoice; full open balance by default. */
export async function pay(ctx: Ctx, id: string, body: PayInvoiceBody): Promise<InvoiceDto> {
  await rollStatuses(ctx.tenantId)
  const inv = await repo.findInvoice(ctx.tenantId, id)
  if (!inv) throw notFound()
  if (!isOpenStatus(inv.status)) throw new AppError(409, 'billing.invoiceNotOpen')
  const r = await recordPayment(ctx, {
    invoiceId: inv.id,
    buildingId: inv.buildingId,
    amountCents: body.amountCents ?? openCentsOf(inv),
    paidAt: body.paidAt,
    method: body.method,
    note: body.note ?? null,
    reference: body.reference ?? inv.paymentReference,
  })
  return (await withCustomerNames(ctx, [toInvoiceDto(r.invoice!)]))[0]!
}

/** Unallocated (or invoice-linked) payment for a building. */
export async function createPayment(ctx: Ctx, body: CreatePaymentBody): Promise<PaymentDto> {
  const r = await recordPayment(ctx, {
    invoiceId: body.invoiceId ?? null,
    buildingId: body.buildingId,
    amountCents: body.amountCents,
    paidAt: body.paidAt,
    method: body.method,
    note: body.note ?? null,
    reference: body.reference ?? null,
  })
  return toPaymentDto(r.payment)
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

/**
 * Customer names come from the registry (one query per distinct contract, cached per call);
 * invoices without a contract (job invoices) resolve the customer by id.
 */
export async function withCustomerNames(ctx: Ctx, dtos: InvoiceDto[]): Promise<InvoiceDto[]> {
  const ids = [...new Set(dtos.map((d) => d.contractId).filter((x): x is string => !!x))]
  const found = await Promise.all(ids.map((id) => contracts.findDto(ctx.tenantId, id)))
  const names = new Map<string, string | undefined>()
  for (const c of found) if (c) names.set(c.id, c.customerName)
  const customerIds = [...new Set(dtos.filter((d) => !d.contractId).map((d) => d.customerId))]
  const customerNames = new Map<string, string>()
  for (const id of customerIds) {
    const c = await customers.get(ctx, id).catch(() => null)
    if (c) customerNames.set(id, c.name)
  }
  return dtos.map((d) => ({
    ...d,
    customerName: d.contractId ? names.get(d.contractId) : customerNames.get(d.customerId),
  }))
}

// ---- credit notes & late fees ------------------------------------------------------------------

/**
 * A numbered credit note against an issued invoice (ADR 0001): reduces the open balance, VAT
 * split in the invoice's own proportion, the invoice row untouched apart from the denormalised
 * creditedCents / status. Full open balance by default.
 */
export async function issueCreditNote(
  ctx: Ctx,
  invoiceId: string,
  body: CreateCreditNoteBody,
): Promise<CreditNoteDto> {
  await rollStatuses(ctx.tenantId)
  const inv = await repo.findInvoice(ctx.tenantId, invoiceId)
  if (!inv) throw notFound()
  if (!isOpenStatus(inv.status)) throw new AppError(409, 'billing.invoiceNotOpen')
  const open = openCentsOf(inv)
  const total = body.totalCents ?? open
  if (total > open) throw new AppError(400, 'billing.creditExceedsOpen')
  const vatCents = inv.totalCents > 0 ? Math.round((total * inv.vatCents) / inv.totalCents) : 0
  const issuedAt = body.issuedAt ?? todayInSofia()
  const today = todayInSofia()
  const cn = await transaction(async (tx) => {
    const number = await repo.nextCreditNoteNumber(ctx.tenantId, tx)
    const row = await repo.createCreditNote(
      ctx.tenantId,
      {
        invoiceId: inv.id,
        number,
        issuedAt: fromDateOnly(issuedAt)!,
        amountCents: total - vatCents,
        vatCents,
        totalCents: total,
        reason: body.reason,
        createdByUserId: ctx.userId || null,
      },
      tx,
    )
    const creditedCents = inv.creditedCents + total
    const status = statusAfterBalanceChange(
      { ...inv, creditedCents, dueAt: toDateOnly(inv.dueAt)! },
      today,
    )
    await repo.updateInvoice(
      ctx.tenantId,
      inv.id,
      { creditedCents, status, ...(status === 'paid' ? { paidAt: fromDateOnly(issuedAt)! } : {}) },
      tx,
    )
    await audit(
      actorOf(ctx),
      {
        action: 'credit_note.issue',
        entityType: 'credit_note',
        entityId: row.id,
        after: { number, invoiceId: inv.id, invoiceNumber: inv.number, totalCents: total, status },
      },
      tx,
    )
    return row
  })
  await events.publish(ctx, {
    type: 'CreditNoteIssued',
    aggregateType: 'invoice',
    aggregateId: inv.id,
    payload: {
      creditNoteId: cn.id,
      number: cn.number,
      invoiceNumber: inv.number,
      totalCents: cn.totalCents,
      reason: cn.reason,
      buildingId: inv.buildingId,
    },
  })
  return toCreditNoteDto(cn)
}

export async function creditNotesOf(ctx: Ctx, invoiceId: string): Promise<CreditNoteDto[]> {
  if (!(await repo.findInvoice(ctx.tenantId, invoiceId))) throw notFound()
  return (await repo.creditNotesForInvoice(ctx.tenantId, invoiceId)).map(toCreditNoteDto)
}

/**
 * A late fee as a separate adjustment row (never a change to the issued invoice); one per
 * (invoice, stage). Returns null when the stage already carries a fee.
 */
export async function applyLateFee(
  tenantId: string,
  invoice: InvoiceRow,
  amountCents: number,
  stageKey: string,
  reason: string,
  tx?: Tx,
): Promise<AdjustmentRow | null> {
  if (amountCents <= 0) return null
  if (await repo.adjustmentForStage(tenantId, invoice.id, stageKey)) return null
  const run = async (t: Tx) => {
    const a = await repo.createAdjustment(
      tenantId,
      { invoiceId: invoice.id, amountCents, reason, stageKey },
      t,
    )
    await repo.updateInvoice(
      tenantId,
      invoice.id,
      { lateFeeCents: invoice.lateFeeCents + amountCents },
      t,
    )
    await audit(
      systemActorOf(tenantId),
      {
        action: 'invoice.lateFee',
        entityType: 'invoice',
        entityId: invoice.id,
        after: { adjustmentId: a.id, amountCents, stageKey },
      },
      t,
    )
    return a
  }
  return tx ? run(tx) : transaction(run)
}

// ---- bulk actions -------------------------------------------------------------------------------

/** "Pay" books the open balance of each selected open invoice today (bank by default). */
export async function bulk(
  ctx: Ctx,
  body: BulkInvoiceBody,
  remind: (ctx: Ctx, ids: string[]) => Promise<number>,
): Promise<BulkInvoiceResultDto> {
  const rows = await repo.findInvoices(ctx.tenantId, body.ids)
  if (body.action === 'remind') {
    const open = rows.filter((r) => isOpenStatus(r.status)).map((r) => r.id)
    const done = await remind(ctx, open)
    return { action: body.action, done, skipped: body.ids.length - done }
  }
  let done = 0
  for (const r of rows) {
    if (!isOpenStatus(r.status)) continue
    await pay(ctx, r.id, {
      paidAt: body.paidAt ?? todayInSofia(),
      method: body.method ?? 'bank',
      note: null,
      reference: null,
    })
    done++
  }
  return { action: body.action, done, skipped: body.ids.length - done }
}

export type { ContractDto }
export { addDays, clock }
