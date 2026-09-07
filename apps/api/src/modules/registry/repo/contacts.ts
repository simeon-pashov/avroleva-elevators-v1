import { prisma } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import { pageArgs } from '../../../platform/http/pagination.js'
import type { Prisma } from '../../../generated/prisma/index.js'

export function listContacts(
  tenantId: string,
  q: { cursor?: string; limit: number; q?: string; customerId?: string; buildingId?: string },
) {
  const where: Prisma.ContactWhereInput = {
    tenantId,
    deletedAt: null,
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(q.q
      ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] }
      : {}),
  }
  return prisma.contact.findMany({ ...pageArgs(q), where })
}

export function contactsForBuilding(tenantId: string, buildingId: string) {
  return prisma.contact.findMany({
    where: { tenantId, buildingId, deletedAt: null },
    orderBy: { isPrimary: 'desc' },
  })
}

export function contactsForCustomer(tenantId: string, customerId: string) {
  return prisma.contact.findMany({
    where: { tenantId, customerId, deletedAt: null },
    orderBy: { isPrimary: 'desc' },
  })
}

export function findContact(tenantId: string, id: string) {
  return prisma.contact.findFirst({ where: { id, tenantId, deletedAt: null } })
}

export type ContactData = Omit<Prisma.ContactUncheckedCreateInput, 'id' | 'tenantId'>

export function createContact(tenantId: string, data: ContactData, tx?: Tx) {
  const db = tx ?? prisma
  return db.contact.create({ data: { id: newId(), tenantId, ...data } })
}

export function updateContact(
  tenantId: string,
  id: string,
  data: Prisma.ContactUncheckedUpdateInput,
) {
  return prisma.contact.update({ where: { id, tenantId }, data })
}
