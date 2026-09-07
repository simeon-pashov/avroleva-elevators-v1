import { prismaBase } from '../../../platform/db/prisma.js'
import { newId } from '../../../platform/ids.js'

export function findAdminByUsername(username: string) {
  return prismaBase.platformAdmin.findUnique({ where: { username } })
}

export function upsertAdmin(username: string, passwordHash: string) {
  return prismaBase.platformAdmin.upsert({
    where: { username },
    create: { id: newId(), username, passwordHash },
    update: { passwordHash },
  })
}
