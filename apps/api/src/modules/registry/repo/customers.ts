import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import { pageArgs } from '../../../platform/http/pagination.js'
import type { CustomerKind, Prisma } from '../../../generated/prisma/index.js'

export function listCustomers(
  tenantId: string,
  q: { cursor?: string; limit: number; q?: string; kind?: CustomerKind },
) {
  const where: Prisma.CustomerWhereInput = {
    tenantId,
    deletedAt: null,
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
  }
  return prisma.customer.findMany({
    ...pageArgs(q),
    where,
    include: { _count: { select: { buildings: { where: { deletedAt: null } } } } },
  })
}

export function findCustomer(tenantId: string, id: string) {
  return prisma.customer.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { _count: { select: { buildings: { where: { deletedAt: null } } } } },
  })
}

export function findCustomerByName(tenantId: string, name: string, tx?: Tx) {
  const db = tx ?? prisma
  return db.customer.findFirst({
    where: { tenantId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
  })
}

export type CustomerData = Omit<Prisma.CustomerUncheckedCreateInput, 'id' | 'tenantId'>

export function createCustomer(tenantId: string, data: CustomerData, tx?: Tx) {
  const db = tx ?? prisma
  return db.customer.create({ data: { id: newId(), tenantId, ...data } })
}

export function updateCustomer(
  tenantId: string,
  id: string,
  data: Prisma.CustomerUncheckedUpdateInput,
) {
  return prisma.customer.update({ where: { id, tenantId }, data })
}

export function countCustomers(tenantId: string) {
  return prisma.customer.count({ where: { tenantId, deletedAt: null } })
}
