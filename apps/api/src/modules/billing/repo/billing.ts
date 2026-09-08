import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { InvoiceStatus, PaymentMethod, Prisma } from '../../../generated/prisma/index.js'

const invoiceInclude = {
  building: { select: { addressText: true } },
} as const
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>

const paymentInclude = {
  building: { select: { addressText: true } },
  invoice: { select: { number: true } },
} as const
export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>

export const OPEN_STATUSES: InvoiceStatus[] = ['issued', 'overdue']

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

export function findInvoice(tenantId: string, id: string, tx?: Tx): Promise<InvoiceRow | null> {
  const db = tx ?? prisma
  return db.invoice.findFirst({ where: { id, tenantId }, include: invoiceInclude })
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

export interface InvoiceInput {
  contractId: string
  buildingId: string
  customerId: string
  number: number
  periodStart: Date
  periodEnd: Date
  issuedAt: Date
  dueAt: Date
  amountCents: number
  vatCents: number
  totalCents: number
  status: InvoiceStatus
  lines: Array<{ elevatorId: string; description: string; amountCents: number }>
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
  },
): Promise<InvoiceRow[]> {
  const where: Prisma.InvoiceWhereInput = {
    tenantId,
    ...(q.status ? { status: q.status } : q.pending ? { status: { in: OPEN_STATUSES } } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.periodStart && q.periodEnd
      ? { periodStart: { gte: q.periodStart, lte: q.periodEnd } }
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

/** issued -> overdue once dueAt is in the past. Called on read (no scheduler yet; see index.ts). */
/** issued -> overdue for invoices past due; returns the rows that changed (once each). */
export async function rollOverdue(tenantId: string, today: Date) {
  const due = await prisma.invoice.findMany({
    where: { tenantId, status: 'issued', dueAt: { lt: today } },
    select: { id: true, number: true, buildingId: true, dueAt: true, totalCents: true },
  })
  if (due.length === 0) return due
  await prisma.invoice.updateMany({
    where: { tenantId, id: { in: due.map((d) => d.id) }, status: 'issued' },
    data: { status: 'overdue' },
  })
  return due
}

export async function openTotals(tenantId: string, buildingId?: string) {
  const rows = await prisma.invoice.findMany({
    where: { tenantId, status: { in: OPEN_STATUSES }, ...(buildingId ? { buildingId } : {}) },
    select: { status: true, totalCents: true, paidCents: true },
  })
  let pendingCents = 0
  let pendingCount = 0
  let overdueCents = 0
  let overdueCount = 0
  for (const r of rows) {
    const open = r.totalCents - r.paidCents
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
}

export function createPayment(tenantId: string, p: PaymentInput, tx?: Tx): Promise<PaymentRow> {
  const db = tx ?? prisma
  return db.payment.create({ data: { id: newId(), tenantId, ...p }, include: paymentInclude })
}

export function listPayments(
  tenantId: string,
  q: { buildingId?: string; from?: Date; to?: Date; limit?: number },
): Promise<PaymentRow[]> {
  return prisma.payment.findMany({
    where: {
      tenantId,
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(q.from || q.to
        ? { paidAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    },
    include: paymentInclude,
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    take: q.limit ?? 200,
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
