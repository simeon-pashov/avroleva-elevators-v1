import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { Prisma, TenantStatus } from '../../../generated/prisma/index.js'

export function findTenant(id: string) {
  return prismaBase.tenant.findFirst({ where: { id, deletedAt: null } })
}

export function listTenants() {
  return prismaBase.tenant.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } })
}

export function findTenantByEik(eik: string) {
  return prismaBase.tenant.findFirst({ where: { eik, deletedAt: null } })
}

export interface CreateTenantInput {
  name: string
  eik: string
  address: string
  phone: string
  emergencyPhone: string
  email?: string | null
  locale: string
  settings?: Prisma.InputJsonValue
}

export function createTenant(input: CreateTenantInput, tx?: Tx) {
  const db = tx ?? prisma
  return db.tenant.create({
    data: {
      id: newId(),
      name: input.name,
      eik: input.eik,
      address: input.address,
      phone: input.phone,
      emergencyPhone: input.emergencyPhone,
      email: input.email ?? null,
      locale: input.locale,
      settings: input.settings ?? {},
    },
  })
}

export function updateTenant(
  id: string,
  data: Partial<{
    name: string
    eik: string
    vatNo: string | null
    address: string
    phone: string
    emergencyPhone: string
    email: string | null
    locale: string
    settings: Prisma.InputJsonValue
    features: Prisma.InputJsonValue
    status: TenantStatus
  }>,
) {
  return prismaBase.tenant.update({ where: { id }, data })
}
