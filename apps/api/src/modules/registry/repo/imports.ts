import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { ImportStatus, Prisma } from '../../../generated/prisma/index.js'

export function createBatch(
  tenantId: string,
  data: {
    filename: string
    rowCount: number
    issues: Prisma.InputJsonValue
    rows: Prisma.InputJsonValue
    createdBy: string
  },
) {
  return prisma.importBatch.create({ data: { id: newId(), tenantId, ...data } })
}

export function findBatch(tenantId: string, id: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.importBatch.findFirst({ where: { id, tenantId } })
}

export function listBatches(tenantId: string) {
  return prisma.importBatch.findMany({ where: { tenantId }, orderBy: { id: 'desc' }, take: 20 })
}

export function setBatchStatus(
  tenantId: string,
  id: string,
  status: ImportStatus,
  createdRows: Prisma.InputJsonValue,
  tx?: Tx,
) {
  const db = tx ?? prisma
  return db.importBatch.update({ where: { id, tenantId }, data: { status, createdRows } })
}
