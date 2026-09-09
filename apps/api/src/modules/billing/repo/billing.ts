import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type {
  InvoiceStatus,
  PaymentMethod,
  PaymentSource,
  Prisma,
} from '../../../generated/prisma/index.js'

const invoiceInclude = {
  building: { select: { addressText: true } },
} as const
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>

const invoiceDetailInclude = {
  building: { select: { addressText: true } },
  payments: { orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] },
  creditNotes: { orderBy: { number: 'desc' } },
  adjustments: { orderBy: { createdAt: 'asc' } },
  paymentLinks: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.InvoiceInclude
export type InvoiceDetailRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>

const paymentInclude = {
  building: { select: { addressText: true } },
  invoice: { select: { number: true } },
} as const
export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>

export type CreditNoteRow = Prisma.CreditNoteGetPayload<{
  include: { invoice: { select: { number: true } } }
}>
export type AdjustmentRow = Prisma.InvoiceAdjustmentGetPayload<object>

export const OPEN_STATUSES: InvoiceStatus[] = ['issued', 'partially_paid', 'overdue']

/**
 * Gapless per-tenant invoice numbers (ЗДДС чл. 114): the sequence row is locked with
 * SELECT ... FOR UPDATE inside the caller's transaction, so two concurrent generations serialise
 * and a rolled-back transaction leaves no hole (the number is only consumed on commit).
 */
export async function nextInvoiceNumber(tenantId: string, tx: Tx): Promise<number> {
  await tx.$executeRaw`INSERT INTO "invoice_sequence" ("tenantId", "nextNumber") VALUES (${tenantId}::uuid, 1) ON CONFLICT ("tenantId") DO NOTHING`
  const rows = await tx.$queryRaw<
    Array<{ nextNumber: number }>
  >`SELECT "nextNumber" FROM "invoice_sequence" WHERE "tenantId" = ${tenantId}::uuid FOR UPDATE`
  const n = rows[0]?.nextNumber ?? 1
  await tx.$executeRaw`UPDATE "invoice_sequence" SET "nextNumber" = ${n + 1} WHERE "tenantId" = ${tenantId}::uuid`
  return n
}

/** Same discipline for credit notes (their own series). */
export async function nextCreditNoteNumber(tenantId: string, tx: Tx): Promise<number> {
  await tx.$executeRaw`INSERT INTO "credit_note_sequence" ("tenantId", "nextNumber") VALUES (${tenantId}::uuid, 1) ON CONFLICT ("tenantId") DO NOTHING`
  const rows = await tx.$queryRaw<
    Array<{ nextNumber: number }>
  >`SELECT "nextNumber" FROM "credit_note_sequence" WHERE "tenantId" = ${tenantId}::uuid FOR UPDATE`
  const n = rows[0]?.nextNumber ?? 1
  await tx.$executeRaw`UPDATE "credit_note_sequence" SET "nextNumber" = ${n + 1} WHERE "tenantId" = ${tenantId}::uuid`
  return n
}

export function findInvoice(tenantId: string, id: string, tx?: Tx): Promise<InvoiceRow | null> {
  const db = tx ?? prisma
  return db.invoice.findFirst({ where: { id, tenantId }, include: invoiceInclude })
}

export function findInvoiceDetail(tenantId: string, id: string): Promise<InvoiceDetailRow | null> {
  return prisma.invoice.findFirst({ where: { id, tenantId }, include: invoiceDetailInclude })
}

export function findInvoices(tenantId: string, ids: string[]): Promise<InvoiceRow[]> {
  if (ids.length === 0) return Promise.resolve([])
  return prisma.invoice.findMany({ where: { tenantId, id: { in: ids } }, include: invoiceInclude })
}

export function findByContractPeriod(
  tenantId: string,
  contractId: string,
  periodStart: Date,
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.invoice.findFirst({ where: { tenantId, contractId, periodStart } })
}

/** Invoices created from a source (job invoices), newest first. */
export function listBySource(
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<InvoiceRow[]> {
  return prisma.invoice.findMany({
    where: { tenantId, sourceType, sourceId },
    include: invoiceInclude,
    orderBy: [{ number: 'desc' }],
  })
}

export function findByReference(tenantId: string, paymentReference: string) {
  return prisma.invoice.findFirst({
    where: { tenantId, paymentReference },
    include: invoiceInclude,
  })
}

export interface InvoiceInput {
  /** null for invoices without a contract (job invoices): sourceType/sourceId carry the origin. */
  contractId: string | null
  buildingId: string
  customerId: string
  number: number
  paymentReference: string
  periodStart: Date
  periodEnd: Date
  issuedAt: Date
  dueAt: Date
  amountCents: number
  vatCents: number
  totalCents: number
  status: InvoiceStatus
  lines: Array<{ elevatorId: string; description: string; amountCents: number }>
  sourceType?: string
  sourceId?: string | null
}

export function createInvoice(tenantId: string, v: InvoiceInput, tx?: Tx): Promise<InvoiceRow> {
  const db = tx ?? prisma
  return db.invoice.create({
    data: { id: newId(), tenantId, ...v, lines: v.lines },
    include: invoiceInclude,
  })
}

export function updateInvoice(
  tenantId: string,
  id: string,
  data: Prisma.InvoiceUncheckedUpdateInput,
  tx?: Tx,
): Promise<InvoiceRow> {
  const db = tx ?? prisma
  return db.invoice.update({ where: { id, tenantId }, data, include: invoiceInclude })
}

export function listInvoices(
  tenantId: string,
  q: {
    cursor?: string
    limit: number
    status?: InvoiceStatus
    pending?: boolean
    buildingId?: string
    customerId?: string
    periodStart?: Date
    periodEnd?: Date
    q?: string
    dunningStage?: number
  },
): Promise<InvoiceRow[]> {
  const number = q.q && /^\d+$/.test(q.q) ? Number(q.q) : null
  const where: Prisma.InvoiceWhereInput = {
    tenantId,
    ...(q.status ? { status: q.status } : q.pending ? { status: { in: OPEN_STATUSES } } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.periodStart && q.periodEnd
      ? { periodStart: { gte: q.periodStart, lte: q.periodEnd } }
      : {}),
    ...(q.dunningStage ? { dunningStage: { gte: q.dunningStage } } : {}),
    ...(q.q
      ? {
          OR: [
            ...(number != null ? [{ number }] : []),
            { paymentReference: { contains: q.q, mode: 'insensitive' as const } },
            { building: { addressText: { contains: q.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }
  return prisma.invoice.findMany({
    where,
    include: invoiceInclude,
    orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  })
}

export function invoicesForBuilding(tenantId: string, buildingId: string, limit = 36) {
  return prisma.invoice.findMany({
    where: { tenantId, buildingId },
    include: invoiceInclude,
    orderBy: [{ periodStart: 'desc' }, { number: 'desc' }],
    take: limit,
  })
}

/** Every invoice of a building (statement), oldest first. */
export function allInvoicesForBuilding(tenantId: string, buildingId: string) {
  return prisma.invoice.findMany({
    where: { tenantId, buildingId },
    include: invoiceInclude,
    orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
  })
}

/** Open invoices of the tenant (dunning, reconciliation), oldest due first. */
export function openInvoices(tenantId: string, buildingId?: string): Promise<InvoiceRow[]> {
  return prisma.invoice.findMany({
    where: { tenantId, status: { in: OPEN_STATUSES }, ...(buildingId ? { buildingId } : {}) },
    include: invoiceInclude,
    orderBy: [{ dueAt: 'asc' }, { number: 'asc' }],
  })
}

/**
 * issued / partially paid -> overdue for invoices past due; returns the rows that changed (once
 * each). One atomic UPDATE ... RETURNING: the roll runs before every billing read and from the
 * daily job, so two concurrent callers must not both "see" the same invoice and emit twice.
 */
export async function rollOverdue(tenantId: string, today: Date) {
  return prisma.$queryRaw<
    { id: string; number: number; buildingId: string; dueAt: Date; totalCents: number }[]
  >`UPDATE "invoice" SET "status" = 'overdue'::"InvoiceStatus", "updatedAt" = now()
    WHERE "tenantId" = ${tenantId}::uuid AND "status" IN ('issued'::"InvoiceStatus", 'partially_paid'::"InvoiceStatus") AND "dueAt" < ${today}
    RETURNING "id", "number", "buildingId", "dueAt", "totalCents"`
}

export async function openTotals(tenantId: string, buildingId?: string) {
  const rows = await prisma.invoice.findMany({
    where: { tenantId, status: { in: OPEN_STATUSES }, ...(buildingId ? { buildingId } : {}) },
    select: {
      status: true,
      totalCents: true,
      paidCents: true,
      lateFeeCents: true,
      creditedCents: true,
    },
  })
  let pendingCents = 0
  let pendingCount = 0
  let overdueCents = 0
  let overdueCount = 0
  for (const r of rows) {
    const open = Math.max(0, r.totalCents + r.lateFeeCents - r.creditedCents - r.paidCents)
    pendingCents += open
    pendingCount++
    if (r.status === 'overdue') {
      overdueCents += open
      overdueCount++
    }
  }
  return { pendingCents, pendingCount, overdueCents, overdueCount }
}

export interface PaymentInput {
  invoiceId: string | null
  buildingId: string
  amountCents: number
  paidAt: Date
  method: PaymentMethod
  note: string | null
  createdByUserId: string | null
  reference?: string | null
  source?: PaymentSource
  provider?: string | null
  providerRef?: string | null
  counterparty?: string | null
  bankImportRowId?: string | null
}

export function createPayment(tenantId: string, p: PaymentInput, tx?: Tx): Promise<PaymentRow> {
  const db = tx ?? prisma
  return db.payment.create({ data: { id: newId(), tenantId, ...p }, include: paymentInclude })
}

export function findPayment(tenantId: string, id: string): Promise<PaymentRow | null> {
  return prisma.payment.findFirst({ where: { id, tenantId }, include: paymentInclude })
}

export function findPaymentByProviderRef(tenantId: string, provider: string, providerRef: string) {
  return prisma.payment.findFirst({ where: { tenantId, provider, providerRef } })
}

export function listPayments(
  tenantId: string,
  q: { buildingId?: string; from?: Date; to?: Date; limit?: number; invoiceId?: string },
): Promise<PaymentRow[]> {
  return prisma.payment.findMany({
    where: {
      tenantId,
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}),
      ...(q.from || q.to
        ? { paidAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    },
    include: paymentInclude,
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    take: q.limit ?? 200,
  })
}

/** Every payment of a building (statement), oldest first. */
export function allPaymentsForBuilding(
  tenantId: string,
  buildingId: string,
): Promise<PaymentRow[]> {
  return prisma.payment.findMany({
    where: { tenantId, buildingId },
    include: paymentInclude,
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
  })
}

export async function paidInRange(tenantId: string, from: Date, to: Date) {
  const r = await prisma.payment.aggregate({
    where: { tenantId, paidAt: { gte: from, lte: to } },
    _sum: { amountCents: true },
    _count: { _all: true },
  })
  return { cents: r._sum.amountCents ?? 0, count: r._count._all }
}

export function countInvoices(tenantId: string) {
  return prisma.invoice.count({ where: { tenantId } })
}

// ---- credit notes & adjustments -------------------------------------------------------------

export function createCreditNote(
  tenantId: string,
  v: {
    invoiceId: string
    number: number
    issuedAt: Date
    amountCents: number
    vatCents: number
    totalCents: number
    reason: string
    createdByUserId: string | null
  },
  tx: Tx,
): Promise<CreditNoteRow> {
  return tx.creditNote.create({
    data: { id: newId(), tenantId, ...v },
    include: { invoice: { select: { number: true } } },
  })
}

export function creditNotesForInvoice(
  tenantId: string,
  invoiceId: string,
): Promise<CreditNoteRow[]> {
  return prisma.creditNote.findMany({
    where: { tenantId, invoiceId },
    include: { invoice: { select: { number: true } } },
    orderBy: { number: 'desc' },
  })
}

export function creditNotesForBuilding(
  tenantId: string,
  buildingId: string,
): Promise<CreditNoteRow[]> {
  return prisma.creditNote.findMany({
    where: { tenantId, invoice: { buildingId } },
    include: { invoice: { select: { number: true } } },
    orderBy: { issuedAt: 'asc' },
  })
}

export function findCreditNote(tenantId: string, id: string): Promise<CreditNoteRow | null> {
  return prisma.creditNote.findFirst({
    where: { tenantId, id },
    include: { invoice: { select: { number: true } } },
  })
}

export function createAdjustment(
  tenantId: string,
  v: { invoiceId: string; amountCents: number; reason: string | null; stageKey: string | null },
  tx: Tx,
): Promise<AdjustmentRow> {
  return tx.invoiceAdjustment.create({ data: { id: newId(), tenantId, kind: 'late_fee', ...v } })
}

export function adjustmentForStage(tenantId: string, invoiceId: string, stageKey: string) {
  return prisma.invoiceAdjustment.findFirst({ where: { tenantId, invoiceId, stageKey } })
}

export function adjustmentsForBuilding(tenantId: string, buildingId: string) {
  return prisma.invoiceAdjustment.findMany({
    where: { tenantId, invoice: { buildingId } },
    include: { invoice: { select: { number: true } } },
    orderBy: { createdAt: 'asc' },
  })
}
