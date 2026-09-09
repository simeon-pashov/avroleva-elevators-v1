import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type {
  BankImportRow,
  BankMatchKind,
  BankRowStatus,
  PaymentLink,
  Prisma,
} from '../../../generated/prisma/index.js'

const importInclude = { rows: { orderBy: { position: 'asc' as const } } } as const
export type ImportRow = Prisma.BankImportGetPayload<{ include: typeof importInclude }>
export type ImportLine = BankImportRow
export type LinkRow = PaymentLink

export function createImport(
  tenantId: string,
  v: {
    filename: string
    mapping: Prisma.InputJsonValue
    createdByUserId: string | null
    rows: Array<{
      position: number
      bookedAt: Date
      amountCents: number
      counterparty: string
      description: string
      reference: string | null
      matchKind: BankMatchKind
      invoiceId: string | null
      status: BankRowStatus
    }>
  },
): Promise<ImportRow> {
  const matched = v.rows.filter((r) => r.status === 'proposed').length
  return prisma.bankImport.create({
    data: {
      id: newId(),
      tenantId,
      filename: v.filename,
      mapping: v.mapping,
      createdByUserId: v.createdByUserId,
      rowCount: v.rows.length,
      matchedCount: matched,
      rows: { create: v.rows.map((r) => ({ id: newId(), tenantId, ...r })) },
    },
    include: importInclude,
  })
}

export function findImport(tenantId: string, id: string, tx?: Tx): Promise<ImportRow | null> {
  const db = tx ?? prisma
  return db.bankImport.findFirst({ where: { tenantId, id }, include: importInclude })
}

export function listImports(tenantId: string, limit = 50): Promise<ImportRow[]> {
  return prisma.bankImport.findMany({
    where: { tenantId },
    include: importInclude,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export function findRow(tenantId: string, importId: string, rowId: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.bankImportRow.findFirst({ where: { tenantId, importId, id: rowId } })
}

export function updateRow(
  tenantId: string,
  rowId: string,
  data: Prisma.BankImportRowUncheckedUpdateInput,
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.bankImportRow.update({ where: { id: rowId, tenantId }, data })
}

export function updateImport(
  tenantId: string,
  id: string,
  data: Prisma.BankImportUncheckedUpdateInput,
  tx?: Tx,
): Promise<ImportRow> {
  const db = tx ?? prisma
  return db.bankImport.update({ where: { id, tenantId }, data, include: importInclude })
}

// ---- payment links ------------------------------------------------------------------------

export function createLink(
  tenantId: string,
  v: {
    invoiceId: string
    provider: string
    token: string
    url: string
    amountCents: number
    expiresAt: Date
  },
): Promise<LinkRow> {
  return prisma.paymentLink.create({ data: { id: newId(), tenantId, ...v } })
}

/**
 * Token lookup is global (the public pay page has no tenant yet; the 128-bit token is the
 * authorisation, like the public QR page), so it uses the unscoped client; the row carries the
 * tenant and every write that follows is scoped by it.
 */
export function findLinkByToken(token: string) {
  return prismaBase.paymentLink.findFirst({
    where: { token },
    include: { invoice: { include: { building: { select: { addressText: true } } } } },
  })
}

export function updateLink(
  tenantId: string,
  id: string,
  data: Prisma.PaymentLinkUncheckedUpdateInput,
  tx?: Tx,
): Promise<LinkRow> {
  const db = tx ?? prisma
  return db.paymentLink.update({ where: { id, tenantId }, data })
}

export function openLinksForInvoice(tenantId: string, invoiceId: string): Promise<LinkRow[]> {
  return prisma.paymentLink.findMany({
    where: { tenantId, invoiceId, status: 'open' },
    orderBy: { createdAt: 'desc' },
  })
}
