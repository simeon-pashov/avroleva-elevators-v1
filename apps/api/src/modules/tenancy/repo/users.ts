import { prisma, prismaBase } from '../../../platform/db/prisma.js'
import type { Tx } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'
import type { UserRole } from '../../../generated/prisma/index.js'

/** Login lookup: username is globally unique, so this is the one unscoped user query. */
export function findUserByUsername(username: string) {
  return prismaBase.user.findUnique({ where: { username }, include: { tenant: true } })
}

export function usernameTaken(username: string) {
  return prismaBase.user.findUnique({ where: { username }, select: { id: true } }).then((r) => !!r)
}

export function listUsers(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })
}

export function findUser(tenantId: string, id: string) {
  return prisma.user.findFirst({ where: { id, tenantId, deletedAt: null } })
}

export function findUsersByIds(tenantId: string, ids: string[]) {
  return prisma.user.findMany({
    where: { tenantId, deletedAt: null, id: { in: ids } },
    select: { id: true, name: true, role: true, isActive: true },
  })
}

export interface CreateUserInput {
  tenantId: string
  username: string
  passwordHash: string
  name: string
  role: UserRole
  email?: string | null
  phone?: string | null
  locale?: string | null
}

export function createUser(input: CreateUserInput, tx?: Tx) {
  const db = tx ?? prisma
  return db.user.create({
    data: {
      id: newId(),
      tenantId: input.tenantId,
      username: input.username,
      passwordHash: input.passwordHash,
      name: input.name,
      role: input.role,
      email: input.email ?? null,
      phone: input.phone ?? null,
      locale: input.locale ?? null,
    },
  })
}

export function updateUser(
  tenantId: string,
  id: string,
  data: Partial<{
    name: string
    role: UserRole
    email: string | null
    phone: string | null
    locale: string | null
    isActive: boolean
    passwordHash: string
    lastLoginAt: Date
  }>,
) {
  return prisma.user.update({ where: { id, tenantId }, data })
}

export function countOwners(tenantId: string) {
  return prisma.user.count({ where: { tenantId, role: 'owner', isActive: true, deletedAt: null } })
}
